// O agente de cobrança, na mesma interface dos outros negócios.
//
// claude.js não sabe qual negócio está atendendo: pede o módulo ao registro e
// chama sempre as mesmas funções. É o que permite trocar de negócio ao vivo e
// é o que faz este nascer sem tocar no núcleo.
export { buildSystemBlocks, buildSystemPrompt, cartaoDoCliente } from "./prompt.js";
export { toolsAtivas, runTool, toolDefinitions } from "./tools.js";

export const nome = "cobranca";

export function rotulo() {
  return process.env.COBRANCA_EMPRESA || "Cobrança";
}
