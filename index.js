import express from 'express';
import dotenv from 'dotenv';
import twilio from 'twilio';
import axios from 'axios';
import fs from 'fs';

dotenv.config();

const { twiml } = twilio;
const { MessagingResponse } = twiml;

// Lê o JSON das perguntas
const perguntas = JSON.parse(fs.readFileSync('./perguntas.json', 'utf-8'));

const app = express();
app.use(express.urlencoded({ extended: false }));

// Armazena sessões por número
const sessions = {};

app.post('/whatsapp', async (req, res) => {
  const from = req.body.From;
  const msg = req.body.Body?.trim();
  const twimlResponse = new MessagingResponse();

  // Início da conversa
  if (!sessions[from]) {
    sessions[from] = {
      etapa: 'nome', // começa pedindo o nome
      respostas: {},
      passo: 0,
      esperandoSugestao: false,
    };
    twimlResponse.message('📢 AUDIÊNCIAS PÚBLICAS - LOA 2025\n\n👤 Qual o seu nome completo?');
    return res.type('text/xml').send(twimlResponse.toString());
  }

  const sessao = sessions[from];

  // Etapa: Nome
  if (sessao.etapa === 'nome') {
    sessao.respostas.nome = msg;
    sessao.etapa = 'perguntas';
  }

  // Etapa: Perguntas
  if (sessao.etapa === 'perguntas') {
    // Se está esperando sugestão livre
    if (sessao.esperandoSugestao) {
      const anterior = perguntas[sessao.passo - 1];
      sessao.respostas[anterior.entry_id] = msg;
      sessao.esperandoSugestao = false;
    } else {
      // Se já respondeu uma pergunta antes, grava a resposta da anterior
      if (sessao.passo > 0) {
        const anterior = perguntas[sessao.passo - 1];
        const p = perguntas[sessao.passo - 1];

        const num = parseInt(msg, 10);
        if (!isNaN(num)) {
          if (num === p.opcoes.length + 1) {
            // Usuário escolheu "Outra sugestão"
            sessao.esperandoSugestao = true;
            twimlResponse.message('✍️ Por favor, escreva sua sugestão para esta área:');
            return res.type('text/xml').send(twimlResponse.toString());
          } else if (num >= 1 && num <= p.opcoes.length) {
            // Escolheu uma opção válida
            sessao.respostas[p.entry_id] = p.opcoes[num - 1];
          } else {
            // Opção inválida
            twimlResponse.message('❌ Opção inválida. Por favor, digite um número válido da lista.');
            return res.type('text/xml').send(twimlResponse.toString());
          }
        } else {
          // Não digitou número
          twimlResponse.message('❌ Por favor, digite o número correspondente à opção desejada.');
          return res.type('text/xml').send(twimlResponse.toString());
        }
      }
    }

    if (sessao.passo >= perguntas.length) {
      sessao.etapa = 'fim';
    } else {
      const p = perguntas[sessao.passo];
      const body =
        `📌 *${p.area.toUpperCase()}*\n\nEscolha uma opção:\n\n` +
        p.opcoes.map((op, i) => `${i + 1}️⃣ ${op}`).join('\n') +
        `\n${p.opcoes.length + 1}️⃣ Outra sugestão (escreva)`;

      const message = twimlResponse.message();
      message.body(body);
      if (p.imagem) {
        message.media(p.imagem);
      }

      sessao.passo++;
      return res.type('text/xml').send(twimlResponse.toString());
    }
  }

  // Etapa: Fim e envio
  if (sessao.etapa === 'fim') {
    const last = perguntas[perguntas.length - 1];
    // Caso não tenha salvo a última resposta (se veio direto para o fim)
    if (!sessao.respostas[last.entry_id]) {
      sessao.respostas[last.entry_id] = msg;
    }

    const formUrl = process.env.GOOGLE_FORM_URL;
    const payload = new URLSearchParams();

    // Campo nome no formulário - ajuste o entry ID conforme seu Google Form
    payload.append('entry.242666768', sessao.respostas.nome);

    perguntas.forEach(p => {
      payload.append(`entry.${p.entry_id}`, sessao.respostas[p.entry_id] || '');
    });

    try {
      await axios.post(formUrl, payload.toString(), {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        }
      });

      twimlResponse.message('✅ Obrigado! Suas respostas foram enviadas com sucesso.');
    } catch (err) {
      console.error('Erro ao enviar para o Google Forms:', err);
      twimlResponse.message('❌ Ocorreu um erro ao enviar suas respostas.');
    }

    delete sessions[from];
    return res.type('text/xml').send(twimlResponse.toString());
  }

  // Fallback para qualquer outro caso
  res.type('text/xml').send(twimlResponse.toString());
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ Bot rodando em http://localhost:${PORT}`);
});
