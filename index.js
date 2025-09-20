import express from 'express';
import dotenv from 'dotenv';
import twilio from 'twilio';
import axios from 'axios';
import fs from 'fs';

dotenv.config();

const { MessagingResponse } = twilio.twiml;

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
    // Aqui você pode validar se digitou um nome (não número)
    if (/^\d+$/.test(msg)) {
      twimlResponse.message('❌ Por favor, digite seu nome completo.');
      return res.type('text/xml').send(twimlResponse.toString());
    }

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

    console.log(`📊 Enviando pergunta 1 (${p.area}), passo agora ${sessao.passo}`);

    return res.type('text/xml').send(twimlResponse.toString());
  }

  // Etapa: Perguntas
  if (sessao.etapa === 'perguntas') {
    if (sessao.esperandoSugestao) {
      // Grava sugestão livre
      const anterior = perguntas[sessao.passo];
      sessao.respostas[anterior.entry_id] = msg;
      sessao.esperandoSugestao = false;

      console.log(`✍️ Sugestão recebida para ${anterior.area}: ${msg}`);

      sessao.passo++; // só incrementa após resposta
    } else {
      // Aqui grava resposta anterior, se existe pergunta respondida
      const p_atual = perguntas[sessao.passo];

      // Quando passo=0, ainda não enviou pergunta, então checa passo > 0 para pegar anterior
      if (sessao.passo > 0) {
        const p_anterior = perguntas[sessao.passo - 1];

        const num = parseInt(msg, 10);
        if (!isNaN(num)) {
          if (num === p_anterior.opcoes.length + 1) {
            sessao.esperandoSugestao = true;
            console.log(`📝 Pessoa escolheu outra sugestão para ${p_anterior.area}`);
            twimlResponse.message('✍️ Por favor, escreva sua sugestão para esta área:');
            return res.type('text/xml').send(twimlResponse.toString());
          } else if (num >= 1 && num <= p_anterior.opcoes.length) {
            sessao.respostas[p_anterior.entry_id] = p_anterior.opcoes[num - 1];
            console.log(`✅ Resposta para ${p_anterior.area}: ${p_anterior.opcoes[num - 1]}`);
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

      sessao.passo++; // incrementa só depois de salvar resposta
    }

    if (sessao.passo >= perguntas.length) {
      sessao.etapa = 'fim';
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

    // Ajuste entry do nome conforme seu Google Form
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

  // Fallback
  console.log(`⚠️ Fallback reached: etapa ${sessao.etapa}, passo ${sessao.passo}`);
  res.type('text/xml').send(twimlResponse.toString());
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ Bot rodando na porta ${PORT}`);
});
