import express from 'express';
import dotenv from 'dotenv';
import twilio from 'twilio';
import axios from 'axios';
import fs from 'fs';

dotenv.config();

const { twiml } = twilio;
const { MessagingResponse } = twiml;

const perguntas = JSON.parse(fs.readFileSync('./perguntas.json', 'utf-8'));

const app = express();
app.use(express.urlencoded({ extended: false }));

const sessions = {};

app.post('/whatsapp', async (req, res) => {
  const rawFrom = req.body.From || '';
  const from = rawFrom.replace('whatsapp:', '').trim(); // 👈 Corrigido aqui
  const msg = req.body.Body?.trim();
  const twimlResponse = new MessagingResponse();

  if (!from || !msg) {
    console.log('⚠️ Requisição inválida');
    return res.status(400).end();
  }

  // Inicia sessão
  if (!sessions[from]) {
    sessions[from] = {
      etapa: 'nome',
      respostas: {},
      passo: 0,
      esperandoSugestao: false,
    };
    console.log(`🚀 Nova sessão para ${from}`);
    twimlResponse.message('📢 AUDIÊNCIAS PÚBLICAS - LOA 2025\n\n👤 Qual o seu nome completo?');
    return res.type('text/xml').send(twimlResponse.toString());
  }

  const sessao = sessions[from];
  console.log(`📩 Mensagem de: ${from} | Etapa: ${sessao.etapa} | Passo: ${sessao.passo} | esperandoSugestao: ${sessao.esperandoSugestao} | Msg: ${msg}`);

  // Etapa: Nome
  if (sessao.etapa === 'nome') {
    sessao.respostas.nome = msg;
    sessao.etapa = 'perguntas';
    sessao.passo = 0;

    const p = perguntas[sessao.passo];
    const body =
      `📌 *${p.area.toUpperCase()}*\n\nEscolha uma opção:\n\n` +
      p.opcoes.map((op, i) => `${i + 1}️⃣ ${op}`).join('\n') +
      `\n${p.opcoes.length + 1}️⃣ Outra sugestão (escreva)`;

    const message = twimlResponse.message();
    message.body(body);
    if (p.imagem) message.media(p.imagem);

    sessao.passo++;
    console.log(`📊 Enviando pergunta 1 (${p.area}), passo agora ${sessao.passo}`);

    return res.type('text/xml').send(twimlResponse.toString());
  }

  // Etapa: Perguntas
  if (sessao.etapa === 'perguntas') {
    if (sessao.esperandoSugestao) {
      const anterior = perguntas[sessao.passo - 1];
      sessao.respostas[anterior.entry_id] = msg;
      sessao.esperandoSugestao = false;
      sessao.passo++;
      console.log(`✍️ Sugestão para ${anterior.area}: ${msg}`);
    } else {
      const anterior = perguntas[sessao.passo - 1];
      const p_ant = perguntas[sessao.passo - 1];

      const num = parseInt(msg, 10);
      if (!isNaN(num)) {
        if (num === p_ant.opcoes.length + 1) {
          sessao.esperandoSugestao = true;
          twimlResponse.message('✍️ Por favor, escreva sua sugestão para esta área:');
          return res.type('text/xml').send(twimlResponse.toString());
        } else if (num >= 1 && num <= p_ant.opcoes.length) {
          sessao.respostas[p_ant.entry_id] = p_ant.opcoes[num - 1];
          console.log(`✅ Resposta para ${p_ant.area}: ${p_ant.opcoes[num - 1]}`);
          sessao.passo++;
        } else {
          twimlResponse.message('❌ Opção inválida. Por favor, digite um número da lista.');
          return res.type('text/xml').send(twimlResponse.toString());
        }
      } else {
        twimlResponse.message('❌ Por favor, envie apenas o número correspondente à opção.');
        return res.type('text/xml').send(twimlResponse.toString());
      }
    }

    // Verifica se terminou
    if (sessao.passo >= perguntas.length) {
      sessao.etapa = 'fim';
      console.log(`🎯 Todas as perguntas respondidas. Indo para etapa final.`);
    }

    if (sessao.etapa === 'perguntas') {
      const p = perguntas[sessao.passo];
      const body =
        `📌 *${p.area.toUpperCase()}*\n\nEscolha uma opção:\n\n` +
        p.opcoes.map((op, i) => `${i + 1}️⃣ ${op}`).join('\n') +
        `\n${p.opcoes.length + 1}️⃣ Outra sugestão (escreva)`;

      const message = twimlResponse.message();
      message.body(body);
      if (p.imagem) message.media(p.imagem);

      console.log(`📊 Enviando pergunta ${sessao.passo + 1} (${p.area})`);
      return res.type('text/xml').send(twimlResponse.toString());
    }
  }

  // Etapa final - Envio do formulário
  if (sessao.etapa === 'fim') {
    const last = perguntas[perguntas.length - 1];
    if (!sessao.respostas[last.entry_id]) {
      sessao.respostas[last.entry_id] = msg;
      console.log(`📝 Última resposta: ${msg}`);
    }

    const formUrl = process.env.GOOGLE_FORM_URL;
    const payload = new URLSearchParams();

    payload.append('entry.242666768', sessao.respostas.nome); // Substitua se precisar

    perguntas.forEach(p => {
      payload.append(`entry.${p.entry_id}`, sessao.respostas[p.entry_id] || '');
    });

    try {
      await axios.post(formUrl, payload.toString(), {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
      });
      console.log('📤 Respostas enviadas ao Google Forms');
      twimlResponse.message('✅ Obrigado! Suas respostas foram enviadas com sucesso.');
    } catch (err) {
      console.error('❌ Erro ao enviar ao Google Forms:', err.message);
      twimlResponse.message('❌ Ocorreu um erro ao enviar suas respostas.');
    }

    delete sessions[from];
    return res.type('text/xml').send(twimlResponse.toString());
  }

  // fallback
  console.log(`⚠️ Fallback ativado para etapa: ${sessao.etapa}`);
  res.type('text/xml').send(twimlResponse.toString());
});

// Inicia o servidor
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ Bot rodando na porta ${PORT}`);
});
