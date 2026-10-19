// Os textos que saem para o cliente. Rode da raiz:
//   node scripts/teste-cobranca-mensagens.mjs
//
// A apresentação é a primeira coisa que qualquer cliente vai ler da empresa
// neste número. Ela tem três trabalhos: dizer que é um robô, cuidar da parte
// de dados, e NÃO dizer que a pessoa deve dinheiro antes de saber quem é a
// pessoa. O terceiro é o que a maioria dos testes daqui protege.
import { APRESENTACAO, APRESENTACAO_OPCOES, apresentacaoPara, montar } from "../src/cobranca/mensagens.js";
import { expressoesCafonas } from "../src/nucleo/tom.js";
import { criarVerificador } from "./fake-sheets.mjs";

const { check, encerrar } = criarVerificador();

const { texto, opcoes, modelo } = apresentacaoPara({
  nome: "Paulo",
  imovel: "Ed. Alfa 801",
  empresa: "Imobiliária Exemplo",
});

// O que ela precisa dizer
check("diz que quem responde é um assistente automático", /assistente autom[áa]tico/i.test(texto));
check("e que tem gente de verdade acompanhando", /pessoa da equipe/i.test(texto));
check("cobre a parte de dados (LGPD)", /seus dados/i.test(texto));
check("e oferece corrigir o dado", /corrigir/i.test(texto));
check("diz de qual empresa é", texto.includes("Imobiliária Exemplo"));
check("e de qual contrato", texto.includes("Ed. Alfa 801"));
check("chama a pessoa pelo nome", texto.includes("Paulo"));
check("e termina perguntando se é ela", /Confirmo que estou falando com Paulo\?/.test(texto));

// O que ela NÃO pode dizer, porque ainda não se sabe quem está do outro lado
check("não leva valor nenhum", !/R\$/.test(texto));
check("não leva código de boleto", !/[A-Z]\d{3}-\d{2}\//.test(texto));
check("não diz que existe parcela em aberto", !/em aberto|atrasad|venc/i.test(texto));
check("não diz a palavra dívida", !/d[íi]vida/i.test(texto));
check("e não cobra nada", !/pagar|pagamento|cobran/i.test(texto));

// Tom
check("nada de expressão cafona", expressoesCafonas(texto).length === 0);
check("sem exclamação", !texto.includes("!"));

// Os botões
check("dois botões, e só", opcoes.length === 2);
check("e são estes", opcoes.join(" / ") === "Sou eu / Número errado");
check("o modelo da Meta tem nome", modelo === "cobranca_apresentacao");

// A substituição
check("chave sem valor some, não vira 'undefined'", montar("Oi, {nome}.", {}) === "Oi, .");
check("chave desconhecida não quebra", montar("Oi, {xpto}.", { nome: "a" }) === "Oi, .");
check("texto sem chave passa igual", montar("Oi.", { nome: "a" }) === "Oi.");
check("o modelo cru guarda as chaves", APRESENTACAO.includes("{nome}") && APRESENTACAO.includes("{imovel}"));

// O nome da empresa vem de fora, para não ficar chumbado no código
const outra = apresentacaoPara({ nome: "X", imovel: "Y", empresa: "Outra Ltda" });
check("a empresa é configurável", outra.texto.includes("Outra Ltda") && !outra.texto.includes("Imobiliária Exemplo"));

encerrar();
