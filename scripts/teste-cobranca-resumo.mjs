// O resumo do dia. Rode da raiz:
//   node scripts/teste-cobranca-resumo.mjs
//
// O resumo é a única coisa que o operador lê todo dia, então o que está sendo
// testado aqui não é "gerou texto": é a ORDEM e a COMPLETUDE. Um item que
// escorrega para o fim da lista, ou que some porque ninguém previu o tipo
// dele, é um cliente esperando resposta que nunca vem.
import { resumoDoDia } from "../src/cobranca/resumo.js";
import { expressoesCafonas } from "../src/nucleo/tom.js";
import { criarVerificador } from "./fake-sheets.mjs";

const { check, encerrar } = criarVerificador();
const HOJE = "2026-09-22"; // uma terça

// ------------------------------------------------------------- um dia cheio
const cheio = resumoDoDia({
  data: HOJE,
  fila: {
    mensagens: [
      { contrato: "A801", tipo: "boleto" },
      { contrato: "L303", tipo: "boleto" },
      { contrato: "B301", tipo: "em_aberto" },
    ],
    interno: [
      {
        contrato: "P212",
        nome: "Vinicius Soares Barreto",
        tipo: "segunda_via",
        parcela: { seuNumero: "P212-08/24", vencimento: "2026-09-14" },
      },
      {
        contrato: "A902",
        nome: "Otávio Campos",
        tipo: "aviso_60",
        botao: null,
        parcela: { seuNumero: "A902-03/12", vencimento: "2026-07-23" },
      },
    ],
    calados: [
      { contrato: "R201", motivo: "nada a dizer hoje" },
      { contrato: "J703", motivo: "nada a dizer hoje" },
      { contrato: "I301", motivo: "o cliente prometeu pagar em 2027-01-15" },
      { contrato: "C103", motivo: "o contrato está com o operador" },
    ],
  },
  conciliacao: {
    baixas: [{ seuNumero: "N501" }, { seuNumero: "D103" }],
    alertas: [
      { seuNumero: "P103-05/38", tipo: "baixado", detalhe: "o Itaú baixou este boleto em 2026-09-20" },
    ],
    duvidas: [
      { seuNumero: "P211-10/38", tipo: "valor-diferente", esperado: 1234.56, recebido: 1394.67 },
    ],
    ignorados: [],
  },
  pendencias: [
    {
      tipo: "robson",
      urgencia: "agora",
      contrato: "B301",
      nome: "Renato Farias Neto",
      motivo: 'disse que recebeu notificação extrajudicial e "estou em desespero aqui"',
    },
    {
      tipo: "comprovante",
      contrato: "C703",
      nome: "Diego Moura Lima",
      seuNumero: "C703-10/48",
      motivo: "mandou comprovante hoje; conferir e dar baixa à mão se não vier no relatório",
    },
    {
      tipo: "adiamento",
      contrato: "A801",
      nome: "Paulo Henrique Duarte",
      seuNumero: "A801-04/05",
      motivo: "pediu para pagar em 25/09",
    },
  ],
});

const t = cheio.texto;

check("abre dizendo o dia da semana e a data", t.startsWith("Resumo de terça, 22/09."));
check("conta quantas coisas precisam dele", /PRECISA DE VOCÊ \(5\)/.test(t));
check("e devolve esse número para quem chama", cheio.precisaDeVoce === 5);

// A ordem é a parte que importa
const pos = (s) => t.indexOf(s);
check("o urgente vem antes de tudo", pos("AGORA") < pos("Comprovante para conferir"));
check("e é o caso do extrajudicial", /AGORA[\s\S]*extrajudicial/.test(t));
check(
  "cliente esperando, comprovante, adiamento e 2ª via, nessa ordem",
  pos("Comprovante para conferir") < pos("Mudar data no banco") &&
    pos("Mudar data no banco") < pos("Emitir 2ª via") &&
    pos("Emitir 2ª via") < pos("Atraso longo")
);
check("o que precisa dele vem antes do que é só conferência", pos("PRECISA DE VOCÊ") < pos("CONFERIR"));
check("e conferência antes do que já foi feito", pos("CONFERIR") < pos("FEITO HOJE"));

// Ninguém pode sumir
check("a 2ª via da régua aparece com boleto e vencimento", /P212-08\/24 · venceu 14\/09/.test(t));
check("o aviso de 60 dias vira 'atraso longo' com os dias", /A902-03\/12.*60 dias de atraso/.test(t));
check("o comprovante aparece com o nome do cliente", /Diego Moura Lima.*comprovante/.test(t));
check("o pedido de adiamento também", /Paulo Henrique Duarte.*pagar em 25\/09/.test(t));

// Conferência
check("as duas conferências são contadas juntas", /CONFERIR \(2\)/.test(t) && cheio.conferir === 2);
check(
  "valor diferente sai em reais, dos dois lados",
  /a planilha diz R\$\s?1\.234,56, o banco cobrou R\$\s?1\.394,67/.test(t)
);
check("o alerta de baixado leva o detalhe junto", /P103-05\/38 · o Itaú baixou/.test(t));

// O que foi feito
check(
  "as mensagens saem agrupadas, com nome de gente e não do código",
  /3 mensagens: 2 boletos, 1 cobrança de atraso\./.test(t) && !t.includes("em_aberto")
);
check(
  "nenhuma data de banco de dados vaza no texto",
  !/\d{4}-\d{2}-\d{2}/.test(t.split("CONFERIR")[0])
);
check("a promessa do cliente aparece no formato de gente", /prometeu pagar em 15\/01/.test(t));
check("as baixas do relatório são contadas", /2 pagamentos confirmados pelo relatório/.test(t));
check(
  "e o silêncio é explicado, do motivo mais comum para o menos",
  /4 contratos em silêncio: 2 nada a dizer hoje;/.test(t)
);

// ------------------------------------------------- o dia bom: nada para ele
const vazio = resumoDoDia({
  data: "2026-09-23",
  fila: { mensagens: [{ contrato: "A801", tipo: "lembrete" }], interno: [], calados: [] },
});
check("dia sem pendência diz isso com todas as letras", /PRECISA DE VOCÊ: nada hoje\./.test(vazio.texto));
check("e não inventa seção de conferência", !vazio.texto.includes("CONFERIR"));
check("mas ainda conta o que o agente fez", /1 mensagem: 1 lembrete\./.test(vazio.texto));
check("e um tipo sem tradução não quebra a contagem", /1 coisa/.test(
  resumoDoDia({ data: HOJE, fila: { mensagens: [{ tipo: "coisa" }] } }).texto
));
check("com o contador zerado para quem chama", vazio.precisaDeVoce === 0 && vazio.conferir === 0);

const nada = resumoDoDia({ data: "2026-09-23", fila: { mensagens: [], interno: [], calados: [] } });
check("dia em que nada saiu não fica com o texto quebrado", /Nenhuma mensagem saiu\./.test(nada.texto));

// --------------------------------------------- o tipo que ninguém previu
// A mesma regra da conciliação: nada é descartado em silêncio. Se um dia
// aparecer uma pendência de tipo novo e ela não tiver bloco, ela cai em
// "Outros" — nunca no vazio.
const estranho = resumoDoDia({
  data: HOJE,
  fila: {},
  pendencias: [{ tipo: "coisa_nova", contrato: "X1", nome: "Fulano", motivo: "algo que ninguém previu" }],
});
check("pendência de tipo desconhecido não some", /Outros \(1\)/.test(estranho.texto));
check("e leva o motivo junto", /Fulano · X1 · algo que ninguém previu/.test(estranho.texto));
check("e continua contando para o total", estranho.precisaDeVoce === 1);

// ------------------------------------------------------------ fora de hora
const foraDeHora = resumoDoDia({
  data: "2026-09-22",
  fila: { mensagens: [{ tipo: "boleto" }], interno: [], calados: [], segura: true, horario: { pode: false, motivo: "depois das 20h" } },
});
check(
  "fora de hora o resumo avisa que a fila está montada, não perdida",
  /depois das 20h.*sai no próximo horário/.test(foraDeHora.texto)
);

// ------------------------------------------------------------------- o tom
// Vale a regra do projeto inteiro: nada de carinho de atendimento, nem para o
// operador. Ele quer a lista, não um abraço.
check("o resumo não tem expressão cafona", expressoesCafonas(t).length === 0);
check("nem exclamação", !t.includes("!"));
check("e cabe numa mensagem de WhatsApp", t.length < 1800);

encerrar();
