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
  const from = req.body.From;
  const msg = req.body.Body?.trim();
  const twimlResponse = new MessagingResponse();

  // Se não tiver sessão, inicia
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
      console.log(`✍️ Sugestão recebida para ${anterior.area}: ${msg}`);
      sessao.passo++;
    } else {
      if (sessao.passo > 0) {
        const anterior = perguntas[sessao.passo - 1];
        const p_ant = perguntas[sessao.passo - 1];

        const num = parseInt(msg, 10);
        if (!isNaN(num)) {
          if (num === p_ant.opcoes.length + 1) {
            sessao.esperandoSugestao = true;
            console.log(`📝 Pessoa escolheu outra sugestão para ${p_ant.area}`);
            twimlResponse.message('✍️ Por favor, escreva sua sugestão para esta área:');
            return res.type('text/xml').send(twimlResponse.toString());
          } else if (num >= 1 && num <= p_ant.opcoes.length) {
            sessao.respostas[p_ant.entry_id] = p_ant.opcoes[num - 1];
            console.log(`✅ Resposta para ${p_ant.area}: ${p_ant.opcoes[num - 1]}`);
          } else {
            console.log(`⚠️ Opção inválida: ${msg}`);
            twimlResponse.message('❌ Opção inválida. Por favor, digite um número válido da lista.');
            return res.type('text/xml').send(twimlResponse.toString());
          }
        } else {
          console.log(`⚠️ Não digitou número: ${msg}`);
          twimlResponse.message('❌ Por favor, digite o número correspondente à opção desejada.');
          return res.type('text/xml').send(twimlResponse.toString());
        }
      }
      sessao.passo++;
    }

    if (sessao.passo >= perguntas.length) {
      sessao.etapa = 'fim';
      console.log(`🎯 Todas as perguntas feitas, avançando para fim`);
    }

    if (sessao.etapa === 'perguntas') {
      const p = perguntas[sessao.passo];
      const body =
        `📌 *${p.area.toUpperCase()}*\n\nEscolha uma opção:\n\n` +
        p.opcoes.map((op, i) => `${i + 1}️⃣ ${op}`).join('\n') +
        `\n${p.opcoes.length + 1}️⃣ Outra sugestão (escreva)`;

      const message = twimlResponse.message();
      message.body(body);

      console.log(`📊 Enviando pergunta ${(sessao.passo + 1)} (${p.area}), passo agora ${sessao.passo}`);

      return res.type('text/xml').send(twimlResponse.toString());
    }
  }

  // Etapa: Fim e envio
  if (sessao.etapa === 'fim') {
    const last = perguntas[perguntas.length - 1];
    if (!sessao.respostas[last.entry_id]) {
      sessao.respostas[last.entry_id] = msg;
      console.log(`📝 Última resposta região ${last.area}: ${msg}`);
    }

    const formUrl = process.env.GOOGLE_FORM_URL;
    const payload = new URLSearchParams();

    // Substitua o entry ID do nome, se necessário
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
      console.log('📤 Enviado ao Google Forms');
      twimlResponse.message('✅ Obrigado! Suas respostas foram enviadas com sucesso.');
    } catch (err) {
      console.error('❌ Erro ao enviar para o Google Forms:', err);
      twimlResponse.message('❌ Ocorreu um erro ao enviar suas respostas.');
    }

    delete sessions[from];
    return res.type('text/xml').send(twimlResponse.toString());
  }

  console.log(`⚠️ Fallback reached: etapa ${sessao.etapa}, passo ${sessao.passo}`);
  res.type('text/xml').send(twimlResponse.toString());
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ Bot rodando na porta ${PORT}`);
});
