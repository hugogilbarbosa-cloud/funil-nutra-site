// Funil Nutra · motor JSON-driven. Lê o slug da URL, busca ofertas/<slug>.json e renderiza a página
// no layout escolhido em "tipo_pagina" (quiz | advertorial | vendas), dispara Pixel/Google Tag, anexa
// sub_id de rastreamento no link de afiliado, trata o botão Voltar (cascata de ofertas) e mostra uma
// página neutra pra quem chega sem UTM de campanha — tudo isso é comum aos 3 layouts.
// Sem build, sem framework — só HTML/CSS/JS pra abrir rápido num anúncio pago. Ver docs/PLAYBOOK-NUTRA-QUIZ.md.

const app = document.getElementById('app');

function escHtml(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function lerSlug() {
  const peloCaminho = location.pathname.match(/^\/q\/([a-z0-9-]+)\/?$/i);
  if (peloCaminho) return peloCaminho[1];
  return new URLSearchParams(location.search).get('oferta') || '';
}

// ---------- Pixel / Google Tag ----------
function carregarMetaPixel(id) {
  if (!id) return;
  window.fbq = window.fbq || function fbq() { (window.fbq.q = window.fbq.q || []).push(arguments); };
  window.fbq('init', id);
  window.fbq('track', 'PageView');
  const s = document.createElement('script');
  s.async = true;
  s.src = 'https://connect.facebook.net/en_US/fbevents.js';
  document.head.appendChild(s);
}
function carregarGoogleTag(id) {
  if (!id) return;
  const s = document.createElement('script');
  s.async = true;
  s.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(id)}`;
  document.head.appendChild(s);
  window.dataLayer = window.dataLayer || [];
  window.gtag = window.gtag || function gtag() { window.dataLayer.push(arguments); };
  window.gtag('js', new Date());
  window.gtag('config', id);
}
function dispararConversao(oferta) {
  try { if (window.fbq) window.fbq('track', 'Lead'); } catch {}
  try { if (window.gtag && oferta.google_tag_id) window.gtag('event', 'conversion', { send_to: oferta.google_tag_id }); } catch {}
}

// ---------- Rastreamento por sub_id (pro painel de afiliados Shopee/ML) ----------
// Shopee e ML identificam cliques por sub_id na própria URL do link de afiliado. Isso só funciona se a
// loja aceitar esse parâmetro no link curto gerado pelo botão Kortexx — confira 1x no painel de afiliados
// se o clique aparece com o sub_id (ver passo 4 do playbook). Se não aparecer, ainda funciona a venda,
// só não vem o detalhe de qual anúncio gerou o clique.
function construirLinkComSubId(linkBase, params) {
  const subs = {
    sub_id1: params.get('utm_source') || params.get('src') || '',
    sub_id2: params.get('utm_campaign') || '',
    sub_id3: params.get('utm_content') || '',
  };
  try {
    const u = new URL(linkBase);
    for (const [k, v] of Object.entries(subs)) if (v) u.searchParams.set(k, v);
    return u.toString();
  } catch {
    return linkBase; // link inválido/relativo: segue sem sub_id em vez de quebrar a página
  }
}

function temUtmDeCampanha(params) {
  return ['utm_source', 'utm_campaign', 'utm_content', 'gclid', 'fbclid', 'src'].some((k) => params.get(k));
}

// O link final pode vir de tela_diagnostico.link_afiliado (layout quiz) ou de link_afiliado na raiz
// (advertorial/vendas) — os dois layouts novos não têm tela de diagnóstico própria.
function lerLinkAfiliadoBase(oferta) {
  return oferta.tela_diagnostico?.link_afiliado || oferta.link_afiliado || '';
}

// ---------- Cascata de back-redirect ----------
// Ao apertar Voltar, em vez de sair da página, mostra um cartão com o próximo passo (back_redirects[0]).
// Se o destino também for uma oferta deste motor com seu próprio back_redirects, o Voltar seguinte nela
// continua a cascata — é assim que "1º Voltar → oferta âncora, 2º Voltar → Telegram" funciona na prática,
// desde que a oferta âncora tenha o Telegram como passo [0] dela.
function iniciarBackRedirect(oferta, renderizarInterstitial) {
  const passo = (oferta.back_redirects || [])[0];
  if (!passo) return;
  history.pushState({ kxBack: true }, '', location.href);
  window.addEventListener('popstate', () => {
    if (passo.auto) { location.href = passo.href; return; }
    renderizarInterstitial(passo);
  }, { once: true });
}

// ---------- Telas comuns ----------
function telaErro(msg) {
  app.innerHTML = `<div class="kx-tela kx-erro">${escHtml(msg)}</div>`;
}

function telaSafePage(oferta) {
  document.title = oferta.titulo_pagina || 'Bem-estar';
  app.innerHTML = `
    <div class="kx-tela">
      <h1 class="kx-headline">${escHtml(oferta.safe_page.titulo)}</h1>
      <p class="kx-subheadline">${escHtml(oferta.safe_page.conteudo)}</p>
    </div>`;
}

function telaInterstitial(passo) {
  app.innerHTML = `
    <div class="kx-tela kx-interstitial">
      <h2 class="kx-headline">${escHtml(passo.titulo)}</h2>
      <p class="kx-subheadline">${escHtml(passo.texto)}</p>
      <a class="kx-botao-cta" href="${escHtml(passo.href)}">${escHtml(passo.texto_botao)}</a>
    </div>`;
}

function ligarCtasComConversao(oferta, linkFinal) {
  // document, não app: a sticky bar vive fora de #app (igual a barra de leitura).
  document.querySelectorAll('[data-kx-cta]').forEach((el) => {
    el.addEventListener('click', (ev) => {
      ev.preventDefault();
      dispararConversao(oferta);
      location.href = linkFinal;
    });
  });
}

// ---------- Componentes de alta conversão (advertorial/vendas) ----------
// Barra fina no topo que acompanha o scroll da matéria — fica fora de #app (sobrevive a re-render).
function iniciarBarraLeitura() {
  if (document.getElementById('kx-barra-leitura')) return;
  const barra = document.createElement('div');
  barra.id = 'kx-barra-leitura';
  barra.innerHTML = '<div id="kx-barra-leitura-fill"></div>';
  document.body.prepend(barra);
  const fill = barra.firstElementChild;
  const atualizar = () => {
    const max = document.documentElement.scrollHeight - window.innerHeight;
    const pct = max > 0 ? Math.min(100, Math.max(0, (window.scrollY / max) * 100)) : 0;
    fill.style.width = pct + '%';
  };
  window.addEventListener('scroll', atualizar, { passive: true });
  atualizar();
}

// Barra de gancho — 1ª coisa que a pessoa vê, antes até do cabeçalho do portal. Texto curto, nunca
// presumindo uma condição pessoal de quem lê ("você tem X?") — Personal Attribute policy da Meta.
function renderizarBarraGancho(texto) {
  if (!texto) return '';
  return `<div class="kx-gancho-topo">${escHtml(texto)}</div>`;
}

// Cabeçalho estilo portal/revista de bem-estar. `portal` é opcional na oferta — usa um padrão sensato.
function renderizarCabecalhoPortal(portal) {
  const nome = portal?.nome || 'Portal Vida & Rotina';
  const iniciais = portal?.iniciais || nome.split(/\s+/).map((p) => p[0]).slice(0, 2).join('').toUpperCase();
  const tempoLeitura = portal?.tempo_leitura || '3 min';
  const categoria = portal?.categoria;
  return `
    <header class="kx-portal-header">
      <div class="kx-portal-marca">
        <span class="kx-portal-avatar">${escHtml(iniciais)}</span>
        <span class="kx-portal-nome">${escHtml(nome)}${categoria ? ` <span class="kx-portal-categoria">• ${escHtml(categoria)}</span>` : ''}</span>
      </div>
      <span class="kx-portal-leitura">📖 Leitura de ${escHtml(tempoLeitura)}</span>
    </header>`;
}

// Sticky bar fixa no rodapé (mobile e desktop) — só aparece depois de rolar 20% da página, e só quando
// a oferta tem foto real do produto + card_oferta (senão não tem o que mostrar de verdade).
function iniciarStickyBar({ imagemProduto, titulo, nota, notaFonte, textoBotaoCurto }) {
  if (!imagemProduto || document.getElementById('kx-sticky-bar')) return;
  const barra = document.createElement('div');
  barra.id = 'kx-sticky-bar';
  barra.innerHTML = `
    <img class="kx-sticky-foto" src="${escHtml(imagemProduto)}" alt="" />
    <div class="kx-sticky-info">
      <span class="kx-sticky-titulo">${escHtml(titulo || 'Oferta oficial')}</span>
      ${nota ? `<span class="kx-sticky-nota">${'★'.repeat(Math.round(nota))} ${nota.toFixed ? nota.toFixed(1) : nota}${notaFonte ? ` (${escHtml(notaFonte)})` : ''}</span>` : ''}
    </div>
    <button type="button" class="kx-sticky-botao" data-kx-cta>${escHtml(textoBotaoCurto || 'Ver oferta')}</button>`;
  document.body.appendChild(barra);
  const atualizar = () => {
    const max = document.documentElement.scrollHeight - window.innerHeight;
    const pct = max > 0 ? window.scrollY / max : 0;
    barra.classList.toggle('kx-sticky-visivel', pct >= 0.2);
  };
  window.addEventListener('scroll', atualizar, { passive: true });
  atualizar();
}

// Linha do tempo da ROTINA (não de resultado físico — nunca prometemos evolução corporal por mês,
// isso seria resultado quantificado/garantido, proibido pela política de saúde da Meta/Google e pela
// regra 4 do CLAUDE.md da raiz). É sobre o hábito amadurecer: construir → manter → consolidar.
function renderizarLinhaTempo(etapas) {
  if (!etapas?.length) return '';
  return `
    <div class="kx-linha-tempo">
      ${etapas.map((e) => `
        <div class="kx-linha-tempo-card">
          <span class="kx-linha-tempo-badge">${escHtml(e.badge)}</span>
          <h3>${escHtml(e.titulo)}</h3>
          <p>${escHtml(e.texto)}</p>
        </div>`).join('')}
    </div>`;
}

// Comparação entre 2 abordagens: cards lado a lado em HTML/CSS puro (zero imagem externa, zero
// copyright, zero corte de texto — texto normal quebra linha sozinho, sem limite de caracteres fixo
// como um SVG teria) + tabela ❌/✅.
function renderizarInfografico(info) {
  if (!info?.coluna_a || !info?.coluna_b) return '';
  const card = (titulo, texto, classe, icone) => `
    <div class="kx-comparativo-card ${classe}">
      <span class="kx-comparativo-icone">${icone}</span>
      <h3>${escHtml(titulo)}</h3>
      <p>${escHtml(texto)}</p>
    </div>`;
  const cards = `
    <div class="kx-comparativo">
      ${card(info.coluna_a.titulo, info.coluna_a.texto, 'kx-comparativo-fraco', '➖')}
      <span class="kx-comparativo-vs">vs</span>
      ${card(info.coluna_b.titulo, info.coluna_b.texto, 'kx-comparativo-forte', '✅')}
    </div>`;
  const tabela = (info.tabela || []).length ? `
    <table class="kx-infografico-tabela">
      <thead><tr><th>Critério</th><th>${escHtml(info.coluna_a.titulo)}</th><th>${escHtml(info.coluna_b.titulo)}</th></tr></thead>
      <tbody>
        ${info.tabela.map((l) => `<tr><td>${escHtml(l.criterio)}</td><td class="kx-infografico-icone">${l.a ? '<span class="kx-check">✅</span>' : '<span class="kx-x">❌</span>'}</td><td class="kx-infografico-icone">${l.b ? '<span class="kx-check">✅</span>' : '<span class="kx-x">❌</span>'}</td></tr>`).join('')}
      </tbody>
    </table>` : '';
  return `<div class="kx-infografico">${cards}${tabela}</div>`;
}

const PALETA_AVATAR = ['#1f7a4d', '#b5762b', '#7a4fb5', '#2b6fb5', '#b54f6f'];
function corAvatar(iniciais) {
  const soma = String(iniciais).split('').reduce((a, c) => a + c.charCodeAt(0), 0);
  return PALETA_AVATAR[soma % PALETA_AVATAR.length];
}

// Prova social estilo portal. SÓ renderiza com dados reais passados na oferta — o motor nunca inventa
// comentário nenhum (regra 4 do CLAUDE.md da raiz: proibido depoimento inventado). Quem monta a oferta
// cola aqui avaliações reais copiadas da própria loja (Shopee/ML).
function renderizarComentarios(comentarios) {
  if (!comentarios?.length) return '';
  return `
    <div class="kx-comentarios">
      <h2 class="kx-diag-titulo">O que as leitoras comentam</h2>
      <div class="kx-comentarios-lista">
        ${comentarios.map((c) => `
          <div class="kx-comentario">
            <div class="kx-comentario-topo">
              <span class="kx-comentario-avatar" style="background:${corAvatar(c.iniciais || c.nome || '?')}">${escHtml(c.iniciais || (c.nome || '?').slice(0, 2).toUpperCase())}</span>
              <div class="kx-comentario-quem">
                <span class="kx-comentario-nome">${escHtml(c.nome || 'Leitora')}</span>
                ${c.verificado ? '<span class="kx-selo-verificado">Leitora Verificada</span>' : ''}
              </div>
            </div>
            ${c.nota ? `<div class="kx-depoimento-nota">${'★'.repeat(Math.round(c.nota))}</div>` : ''}
            <p>${escHtml(c.texto)}</p>
          </div>`).join('')}
      </div>
    </div>`;
}

function formatarReais(n) {
  return 'R$ ' + Number(n).toFixed(2).replace('.', ',');
}

// Card de oferta final, alto contraste, com selo de prova social verificável e CTA com pulse sutil.
// `imagemProduto` (opcional) cria conexão visual imediata com o que a pessoa vai ver no checkout.
// `preco_de`/`preco_por` (números reais, nunca invente) mostram a âncora De/Por riscada.
function renderizarCardOferta(cardOferta, textoBotaoFallback, imagemProduto) {
  if (!cardOferta) return '';
  const temPreco = cardOferta.preco_de && cardOferta.preco_por;
  return `
    <div class="kx-card-oferta">
      ${cardOferta.selo ? `<div class="kx-card-oferta-selo">✅ ${escHtml(cardOferta.selo)}</div>` : ''}
      ${imagemProduto ? `<div class="kx-card-oferta-foto-wrap"><img class="kx-card-oferta-produto" src="${escHtml(imagemProduto)}" alt="Foto do produto" /></div>` : ''}
      ${temPreco ? `
        <div class="kx-card-oferta-preco">
          <span class="kx-card-oferta-preco-de">De ${escHtml(formatarReais(cardOferta.preco_de))}</span>
          <span class="kx-card-oferta-preco-por">Por ${escHtml(formatarReais(cardOferta.preco_por))}</span>
          ${cardOferta.parcelamento_texto ? `<span class="kx-card-oferta-parcelamento">${escHtml(cardOferta.parcelamento_texto)}</span>` : ''}
        </div>` : ''}
      ${(cardOferta.beneficios || []).length ? `<ul class="kx-beneficios">${cardOferta.beneficios.map((b) => `<li>${escHtml(b)}</li>`).join('')}</ul>` : ''}
      ${cardOferta.disponibilidade_texto ? `<div class="kx-escassez">⏰ ${escHtml(cardOferta.disponibilidade_texto)}</div>` : ''}
      <button type="button" class="kx-botao-cta kx-botao-cta-pulse" data-kx-cta>${escHtml(cardOferta.texto_botao || textoBotaoFallback || 'Quero aproveitar a oferta')}</button>
      ${cardOferta.micro_texto_seguranca ? `<p class="kx-micro-seguranca">🔒 ${escHtml(cardOferta.micro_texto_seguranca)}</p>` : ''}
    </div>`;
}

// ---------- Layout "quiz" (perguntas + resultado) ----------
// Formato legado: tela_diagnostico fixa, sempre igual pra todo mundo (compatível com ofertas antigas).
function telaDiagnostico(oferta, linkFinal) {
  const d = oferta.tela_diagnostico;
  app.innerHTML = `
    <div class="kx-tela">
      <h2 class="kx-diag-titulo">${escHtml(d.titulo)}</h2>
      <ul class="kx-beneficios">${d.beneficios.map((b) => `<li>${escHtml(b)}</li>`).join('')}</ul>
      ${d.texto_escassez ? `<div class="kx-escassez">⏰ ${escHtml(d.texto_escassez)}</div>` : ''}
      <button type="button" class="kx-botao-cta" data-kx-cta>${escHtml(d.texto_botao)}</button>
      ${oferta.aviso_legal ? `<p class="kx-aviso-legal">${escHtml(oferta.aviso_legal)}</p>` : ''}
    </div>`;
  ligarCtasComConversao(oferta, linkFinal);
}

// Formato com pontuação: cada opção soma pontos, e o total decide qual faixa de `oferta.resultado.faixas`
// aparece (ordenadas por "max" crescente, a 1ª cujo max >= pontuação total vence). NUNCA é um índice
// clínico/diagnóstico (nada de "Índice de Fragilidade: 84/100") — é só uma forma de personalizar QUAL
// mensagem aparece antes do mesmo card_oferta, sem fingir medir algo que o quiz não mede de verdade.
// Pontuação máxima possível, somando a maior opção de cada pergunta — usada só pra mostrar "X de Y
// pontos" de forma honesta (nunca um índice reescalado tipo "/100": isso fingiria uma precisão que o
// quiz não tem, por ser só soma de múltipla escolha).
function pontuacaoMaximaQuiz(perguntas) {
  return perguntas.reduce((acc, p) => {
    const maxDaPergunta = Math.max(0, ...p.opcoes.map((o) => (typeof o === 'string' ? 0 : (o.pontos || 0))));
    return acc + maxDaPergunta;
  }, 0);
}

function telaResultadoQuiz(oferta, pontuacao, linkFinal) {
  const faixa = oferta.resultado.faixas.find((f) => pontuacao <= f.max) || oferta.resultado.faixas.at(-1);
  const maxPontos = pontuacaoMaximaQuiz(oferta.perguntas);
  const pct = maxPontos > 0 ? Math.min(100, Math.max(0, (pontuacao / maxPontos) * 100)) : 0;
  app.innerHTML = `
    <div class="kx-tela">
      <div class="kx-resultado-perfil">${escHtml(faixa.perfil)}</div>
      <div class="kx-pontuacao-quiz">
        <div class="kx-pontuacao-quiz-barra"><div class="kx-pontuacao-quiz-fill" style="width:${pct}%"></div></div>
        <span class="kx-pontuacao-quiz-texto">Pontuação do quiz: ${pontuacao} de ${maxPontos}</span>
      </div>
      <h2 class="kx-diag-titulo">${escHtml(faixa.titulo || 'Com base nas suas respostas')}</h2>
      <p class="kx-subheadline">${escHtml(faixa.texto)}</p>
      ${oferta.card_oferta ? renderizarCardOferta(oferta.card_oferta, null, oferta.imagem_produto) : ''}
      ${renderizarComentarios(oferta.comentarios)}
      ${oferta.aviso_legal ? `<p class="kx-aviso-legal">${escHtml(oferta.aviso_legal)}</p>` : ''}
    </div>`;
  if (oferta.imagem_produto && oferta.card_oferta) {
    iniciarStickyBar({
      imagemProduto: oferta.imagem_produto,
      titulo: oferta.titulo_pagina,
      nota: oferta.card_oferta.nota,
      notaFonte: oferta.card_oferta.nota_fonte,
      textoBotaoCurto: oferta.card_oferta.texto_botao_curto,
    });
  }
  ligarCtasComConversao(oferta, linkFinal);
}

function telaPergunta(oferta, indice, total, avancar) {
  const p = oferta.perguntas[indice];
  app.innerHTML = `
    <div class="kx-tela">
      ${(oferta.imagem_capa || oferta.imagem_produto) && indice === 0 ? `<img class="kx-img-produto" src="${escHtml(oferta.imagem_capa || oferta.imagem_produto)}" alt="" />` : ''}
      <div class="kx-progresso">${Array.from({ length: total }, (_, i) => `<span class="${i <= indice ? 'kx-ativo' : ''}"></span>`).join('')}</div>
      ${indice === 0 ? `<h1 class="kx-headline">${escHtml(oferta.headline_inicial)}</h1><p class="kx-subheadline">${escHtml(oferta.subheadline)}</p>` : ''}
      <p class="kx-pergunta">${escHtml(p.texto)}</p>
      <div class="kx-opcoes">
        ${p.opcoes.map((o, i) => `<button type="button" class="kx-opcao" data-i="${i}">${escHtml(typeof o === 'string' ? o : o.texto)}</button>`).join('')}
      </div>
    </div>`;
  app.querySelectorAll('.kx-opcao').forEach((b, i) => b.addEventListener('click', () => avancar(typeof p.opcoes[i] === 'string' ? 0 : (p.opcoes[i].pontos || 0))));
}

function iniciarQuiz(oferta, linkFinal) {
  let indice = 0;
  let pontuacao = 0;
  const total = oferta.perguntas.length;
  const avancar = (pontos) => {
    pontuacao += pontos || 0;
    indice++;
    if (indice < total) telaPergunta(oferta, indice, total, avancar);
    else if (oferta.resultado?.faixas?.length) telaResultadoQuiz(oferta, pontuacao, linkFinal);
    else telaDiagnostico(oferta, linkFinal);
  };
  telaPergunta(oferta, indice, total, avancar);
}

// ---------- Layout "advertorial" (manchete + matéria editorial + CTA) ----------
function renderizarBlocoAdvertorial(b) {
  if (b.tipo === 'subtitulo') return `<h2 class="kx-adv-subtitulo">${escHtml(b.texto)}</h2>`;
  if (b.tipo === 'citacao') return `<blockquote class="kx-adv-citacao">${escHtml(b.texto)}</blockquote>`;
  if (b.tipo === 'imagem') return `<img class="kx-adv-imagem" src="${escHtml(b.src)}" alt="${escHtml(b.alt || '')}" />`;
  return `<p class="kx-adv-paragrafo">${escHtml(b.texto)}</p>`;
}

function iniciarAdvertorial(oferta, linkFinal) {
  const a = oferta.advertorial;
  document.title = oferta.titulo_pagina || a.manchete || 'Matéria';
  iniciarBarraLeitura();
  app.innerHTML = `
    <article class="kx-tela kx-advertorial">
      ${renderizarBarraGancho(a.gancho_topo)}
      ${renderizarCabecalhoPortal(oferta.portal)}
      ${a.categoria ? `<div class="kx-adv-categoria">${escHtml(a.categoria)}</div>` : ''}
      <h1 class="kx-adv-manchete">${escHtml(a.manchete)}</h1>
      <div class="kx-adv-meta">${[a.autor, a.data].filter(Boolean).map(escHtml).join(' · ')}</div>
      ${a.imagem_destaque ? `
        <figure class="kx-adv-figura">
          <img class="kx-adv-imagem" src="${escHtml(a.imagem_destaque)}" alt="${escHtml(a.imagem_destaque_alt || '')}" />
          ${a.imagem_destaque_legenda ? `<figcaption class="kx-adv-legenda">${escHtml(a.imagem_destaque_legenda)}</figcaption>` : ''}
        </figure>` : ''}
      <div class="kx-adv-corpo">${(a.blocos || []).map(renderizarBlocoAdvertorial).join('')}</div>
      ${renderizarInfografico(a.infografico)}
      ${renderizarLinhaTempo(a.linha_tempo)}
      ${a.caixa_destaque ? `
        <div class="kx-adv-destaque">
          <h3>${escHtml(a.caixa_destaque.titulo)}</h3>
          <p>${escHtml(a.caixa_destaque.texto)}</p>
        </div>` : ''}
      ${a.card_oferta ? renderizarCardOferta(a.card_oferta, a.cta?.texto_botao, a.imagem_produto) : `
        <div class="kx-adv-cta">
          ${a.cta?.texto_antes ? `<p class="kx-subheadline">${escHtml(a.cta.texto_antes)}</p>` : ''}
          <button type="button" class="kx-botao-cta" data-kx-cta>${escHtml(a.cta?.texto_botao || 'Ver oferta oficial')}</button>
        </div>`}
      ${renderizarComentarios(a.comentarios)}
      ${oferta.aviso_legal ? `<p class="kx-aviso-legal">${escHtml(oferta.aviso_legal)}</p>` : ''}
    </article>`;
  if (a.imagem_produto && a.card_oferta) {
    iniciarStickyBar({
      imagemProduto: a.imagem_produto,
      titulo: oferta.titulo_pagina,
      nota: a.card_oferta.nota,
      notaFonte: a.card_oferta.nota_fonte,
      textoBotaoCurto: a.card_oferta.texto_botao_curto,
    });
  }
  ligarCtasComConversao(oferta, linkFinal);
}

// ---------- Layout "vendas" (Direct Response: VSL + benefícios + prova + garantia + FAQ) ----------
function iniciarVendas(oferta, linkFinal) {
  const v = oferta.vendas;
  document.title = oferta.titulo_pagina || v.headline || 'Oferta';
  iniciarBarraLeitura();
  const midia = v.video_url
    ? `<div class="kx-vsl"><iframe src="${escHtml(v.video_url)}" allow="autoplay; fullscreen" allowfullscreen loading="lazy"></iframe></div>`
    : v.imagem_principal
      ? `<figure class="kx-adv-figura"><img class="kx-vendas-imagem" src="${escHtml(v.imagem_principal)}" alt="" />${v.imagem_principal_legenda ? `<figcaption class="kx-adv-legenda">${escHtml(v.imagem_principal_legenda)}</figcaption>` : ''}</figure>`
      : '';
  app.innerHTML = `
    <div class="kx-tela kx-vendas">
      ${renderizarBarraGancho(v.gancho_topo)}
      ${renderizarCabecalhoPortal(oferta.portal)}
      <h1 class="kx-headline">${escHtml(v.headline)}</h1>
      ${v.subheadline ? `<p class="kx-subheadline">${escHtml(v.subheadline)}</p>` : ''}
      ${midia}
      <button type="button" class="kx-botao-cta" data-kx-cta>${escHtml(v.cta_topo || 'Quero aproveitar a oferta')}</button>

      ${(v.beneficios || []).length ? `
        <div class="kx-vendas-beneficios">
          ${v.beneficios.map((b) => `
            <div class="kx-vendas-beneficio">
              <h3>${escHtml(b.titulo)}</h3>
              <p>${escHtml(b.texto)}</p>
            </div>`).join('')}
        </div>` : ''}

      ${renderizarInfografico(v.infografico)}
      ${renderizarLinhaTempo(v.linha_tempo)}

      ${v.garantia ? `
        <div class="kx-vendas-garantia">
          <h3>${escHtml(v.garantia.titulo)}</h3>
          <p>${escHtml(v.garantia.texto)}</p>
        </div>` : ''}

      ${(v.faq || []).length ? `
        <div class="kx-vendas-faq">
          <h2 class="kx-diag-titulo">Perguntas frequentes</h2>
          ${v.faq.map((f) => `
            <details class="kx-faq-item">
              <summary>${escHtml(f.pergunta)}</summary>
              <p>${escHtml(f.resposta)}</p>
            </details>`).join('')}
        </div>` : ''}

      ${v.card_oferta ? renderizarCardOferta(v.card_oferta, v.cta_final || v.cta_topo, v.imagem_produto) : `
        <button type="button" class="kx-botao-cta" data-kx-cta>${escHtml(v.cta_final || v.cta_topo || 'Quero aproveitar a oferta')}</button>`}
      ${renderizarComentarios(v.depoimentos)}
      ${oferta.aviso_legal ? `<p class="kx-aviso-legal">${escHtml(oferta.aviso_legal)}</p>` : ''}
    </div>`;
  if (v.imagem_produto && v.card_oferta) {
    iniciarStickyBar({
      imagemProduto: v.imagem_produto,
      titulo: oferta.titulo_pagina,
      nota: v.card_oferta.nota,
      notaFonte: v.card_oferta.nota_fonte,
      textoBotaoCurto: v.card_oferta.texto_botao_curto,
    });
  }
  ligarCtasComConversao(oferta, linkFinal);
}

// ---------- Principal ----------
async function iniciar() {
  const slug = lerSlug();
  if (!slug) return telaErro('Oferta não especificada. Abra pelo link /q/<oferta> ou ?oferta=<oferta>.');

  let oferta;
  try {
    const r = await fetch(`ofertas/${encodeURIComponent(slug)}.json`, { cache: 'no-store' });
    if (!r.ok) throw new Error(String(r.status));
    oferta = await r.json();
  } catch {
    return telaErro('Não encontrei essa oferta. Confira o link.');
  }

  document.title = oferta.titulo_pagina || 'Oferta';
  const params = new URLSearchParams(location.search);

  if (oferta.safe_page?.ativo && !temUtmDeCampanha(params)) return telaSafePage(oferta);

  carregarMetaPixel(oferta.pixel_id);
  carregarGoogleTag(oferta.google_tag_id);

  const linkFinal = construirLinkComSubId(lerLinkAfiliadoBase(oferta), params);
  iniciarBackRedirect(oferta, telaInterstitial);

  const tipo = oferta.tipo_pagina || 'quiz';
  if (tipo === 'advertorial') return iniciarAdvertorial(oferta, linkFinal);
  if (tipo === 'vendas') return iniciarVendas(oferta, linkFinal);
  iniciarQuiz(oferta, linkFinal);
}

iniciar();
