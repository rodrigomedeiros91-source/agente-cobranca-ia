/**
 * O resumo do dia: uma mensagem para o operador, em vez de vinte.
 *
 * POR QUE ISTO EXISTE
 *
 * Cada coisa que o agente não pode resolver hoje vira um toque no WhatsApp do
 * operador: pedido de 2ª via, pedido de adiamento, comprovante que chegou,
 * cliente que falou em advogado, divergência no relatório do banco. Com 16
 * contratos isso é fácil de virar uma dúzia de interrupções por dia — e quem é
 * interrompido doze vezes não supervisiona nada, só apaga incêndio.
 *
 * A decisão, de 22/09/2026, é que o objetivo do projeto não é o operador
 * trabalhar menos por trabalhar menos: é que **tudo que chega nele exija a
 * cabeça dele, e não a digitação**. Juntar os recados num só é o primeiro passo
 * disso, e é o único que não depende de ninguém de fora.
 *
 * A ORDEM É A MENSAGEM
 *
 * Primeiro o que precisa dele, depois o que só precisa de conferência, por
 * último o que já foi feito. Quem abre o resumo e não vê nada no topo pode
 * fechar e seguir a vida — e é exatamente esse o dia bom.
 *
 * Dentro de "precisa de você", urgência `agora` vem antes de tudo. Se alguém
 * escreveu falando em notificação extrajudicial ou em desespero, isso não pode
 * estar na décima linha de uma lista de segundas vias.
 *
 * FUNÇÃO PURA
 *
 * Entra o que aconteceu, sai texto. Sem relógio, sem rede, sem planilha: o
 * teste monta um dia inteiro em dez linhas e confere a mensagem palavra por
 * palavra. O `WhatsApp` é problema de quem chama.
 */

const DIAS = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];

const meioDia = (iso) => new Date(`${String(iso).slice(0, 10)}T12:00:00Z`);
const porExtenso = (iso) => {
  const s = String(iso || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const [, m, d] = s.split("-");
  return `${d}/${m}`;
};
const diaDaSemana = (iso) => DIAS[meioDia(iso).getUTCDay()];
const moeda = (v) =>
  Number(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

/** "3 boletos" / "1 boleto" — plural sem gambiarra de `(s)`. */
const conta = (n, um, muitos) => `${n} ${n === 1 ? um : muitos}`;

/**
 * Nome interno do evento -> nome que uma pessoa lê.
 *
 * `em_aberto` e `apresentacao` são nomes do código. Vazar isso no resumo faz o
 * operador ter que traduzir mentalmente todo dia, e ainda entrega que ninguém
 * leu a mensagem antes de mandar.
 */
const NOME_DO_EVENTO = {
  boleto: ["boleto", "boletos"],
  lembrete: ["lembrete", "lembretes"],
  venceu: ["aviso de vencimento", "avisos de vencimento"],
  em_aberto: ["cobrança de atraso", "cobranças de atraso"],
  apresentacao: ["apresentação", "apresentações"],
};

/** Datas AAAA-MM-DD que vêm de dentro do sistema viram 15/01 no texto. */
const humanizarDatas = (texto) =>
  String(texto).replace(/\b(\d{4})-(\d{2})-(\d{2})\b/g, (_, a, m, d) => `${d}/${m}`);

/**
 * Como cada tipo de pendência aparece no resumo.
 *
 * `ordem` decide a posição do bloco; urgência `agora` fura a fila de qualquer
 * jeito, então esta ordem só vale entre os não urgentes.
 */
const BLOCOS = [
  { tipo: "robson", ordem: 1, titulo: "Cliente esperando você" },
  { tipo: "comprovante", ordem: 2, titulo: "Comprovante para conferir" },
  { tipo: "adiamento", ordem: 3, titulo: "Mudar data no banco" },
  { tipo: "segunda_via", ordem: 4, titulo: "Emitir 2ª via" },
  { tipo: "aviso", ordem: 5, titulo: "Atraso longo" },
];

const identifica = (item) =>
  [item.nome, item.contrato].filter(Boolean).join(" · ") || item.contrato || "(sem nome)";

function linhaDePendencia(item) {
  const partes = [identifica(item)];
  if (item.seuNumero) partes.push(item.seuNumero);
  if (item.vencimento) partes.push(`venceu ${porExtenso(item.vencimento)}`);
  if (item.motivo) partes.push(humanizarDatas(item.motivo));
  return `· ${partes.join(" · ")}`;
}

function linhaDeConferencia(item) {
  if (item.tipo === "valor-diferente") {
    return `· ${item.seuNumero} · valor diferente: a planilha diz ${moeda(item.esperado)}, o banco cobrou ${moeda(item.recebido)}`;
  }
  return `· ${item.seuNumero} · ${item.detalhe || item.tipo}`;
}

/**
 * Monta o resumo.
 *
 * @param {string}   data          - AAAA-MM-DD
 * @param {object}   fila          - o que `filaDoDia` devolveu
 * @param {object}   conciliacao   - o que `conciliar` devolveu, se rodou hoje
 * @param {object[]} pendencias    - { tipo, urgencia, contrato, nome, seuNumero, vencimento, motivo }
 * @returns {{ texto, precisaDeVoce, conferir }}
 */
export function resumoDoDia({ data = "", fila = {}, conciliacao = null, pendencias = [] } = {}) {
  const { mensagens = [], interno = [], calados = [] } = fila;

  // Os avisos de 30/60/90 dias nascem dentro da régua, não de uma conversa.
  // Entram na mesma lista das outras pendências para o operador ver tudo num
  // lugar só — senão ele teria que olhar o resumo E o painel.
  const daRegua = interno.map((x) => ({
    tipo: x.tipo === "segunda_via" ? "segunda_via" : "aviso",
    contrato: x.contrato,
    nome: x.nome,
    seuNumero: x.parcela?.seuNumero,
    vencimento: x.parcela?.vencimento,
    motivo: x.tipo.startsWith("aviso_") ? `${x.tipo.split("_")[1]} dias de atraso` : undefined,
    botao: x.botao,
  }));

  const todas = [...pendencias, ...daRegua];
  const urgentes = todas.filter((x) => x.urgencia === "agora");
  const resto = todas.filter((x) => x.urgencia !== "agora");

  const linhas = [];
  linhas.push(`Resumo de ${diaDaSemana(data)}, ${porExtenso(data)}.`);

  if (todas.length) {
    linhas.push("");
    linhas.push(`PRECISA DE VOCÊ (${todas.length})`);

    if (urgentes.length) {
      linhas.push("");
      linhas.push("AGORA");
      for (const item of urgentes) linhas.push(linhaDePendencia(item));
    }

    for (const bloco of [...BLOCOS].sort((a, b) => a.ordem - b.ordem)) {
      const doBloco = resto.filter((x) => x.tipo === bloco.tipo);
      if (!doBloco.length) continue;
      linhas.push("");
      linhas.push(`${bloco.titulo} (${doBloco.length})`);
      for (const item of doBloco) linhas.push(linhaDePendencia(item));
    }

    // Tipo que ninguém previu não pode sumir. Some um item da lista e o
    // operador nunca fica sabendo que ele existiu — o mesmo princípio da
    // conciliação, onde todo lançamento cai em exatamente uma lista.
    const previstos = new Set(BLOCOS.map((b) => b.tipo));
    const sobrou = resto.filter((x) => !previstos.has(x.tipo));
    if (sobrou.length) {
      linhas.push("");
      linhas.push(`Outros (${sobrou.length})`);
      for (const item of sobrou) linhas.push(linhaDePendencia(item));
    }
  } else {
    linhas.push("");
    linhas.push("PRECISA DE VOCÊ: nada hoje.");
  }

  const conferir = [...(conciliacao?.alertas || []), ...(conciliacao?.duvidas || [])];
  if (conferir.length) {
    linhas.push("");
    linhas.push(`CONFERIR (${conferir.length})`);
    for (const item of conferir) linhas.push(linhaDeConferencia(item));
  }

  linhas.push("");
  linhas.push("FEITO HOJE");

  if (mensagens.length) {
    const porTipo = new Map();
    for (const m of mensagens) porTipo.set(m.tipo, (porTipo.get(m.tipo) || 0) + 1);
    const detalhe = [...porTipo.entries()]
      .map(([tipo, n]) => {
        const nome = NOME_DO_EVENTO[tipo] || [tipo, tipo];
        return conta(n, nome[0], nome[1]);
      })
      .join(", ");
    linhas.push(`${conta(mensagens.length, "mensagem", "mensagens")}: ${detalhe}.`);
  } else {
    linhas.push("Nenhuma mensagem saiu.");
  }

  if (conciliacao?.baixas?.length) {
    linhas.push(`${conta(conciliacao.baixas.length, "pagamento confirmado", "pagamentos confirmados")} pelo relatório do banco.`);
  }

  if (calados.length) {
    const porMotivo = new Map();
    for (const c of calados) porMotivo.set(c.motivo, (porMotivo.get(c.motivo) || 0) + 1);
    const detalhe = [...porMotivo.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([motivo, n]) => `${n} ${humanizarDatas(motivo)}`)
      .join("; ");
    linhas.push(`${conta(calados.length, "contrato em silêncio", "contratos em silêncio")}: ${detalhe}.`);
  }

  if (fila.segura) {
    linhas.push(`Fora do horário de falar (${fila.horario?.motivo}): a fila está montada e sai no próximo horário.`);
  }

  return { texto: linhas.join("\n"), precisaDeVoce: todas.length, conferir: conferir.length };
}
