/**
 * Dublê do Google Sheets para os testes.
 *
 * Guarda em memória o que a API guardaria de verdade: abas, regras de cor,
 * proteções e os valores escritos. Não é um mock que só devolve `true`; ele
 * simula o estado, que é o que permite testar reinício repetido do servidor
 * sem duplicar aba nem empilhar regra.
 *
 * Antes isto vivia dentro de node_modules/googleapis, substituindo a
 * biblioteca real. Funcionava só na máquina de quem armou o truque. Agora é
 * um arquivo comum, instalado pelo teste via useFakeSheetsClient().
 */

export function criarDuble() {
  const chamadas = [];
  const abas = new Map([["Fichas", { sheetId: 0, title: "Fichas", index: 0 }]]);
  const regras = new Map([[0, []]]);
  const protecoes = new Map();
  const valores = new Map();

  let proximoId = 1;
  let proximaProtecao = 100;

  const client = {
    spreadsheets: {
      get: async (args) => {
        chamadas.push({ nome: "get", args });
        return {
          data: {
            sheets: [...abas.values()].map((properties) => ({
              properties,
              conditionalFormats: regras.get(properties.sheetId) || [],
              protectedRanges: [...protecoes.entries()]
                .filter(([, p]) => p.sheetId === properties.sheetId)
                .map(([protectedRangeId, p]) => ({
                  protectedRangeId,
                  description: p.description,
                })),
            })),
          },
        };
      },

      create: async (args) => {
        chamadas.push({ nome: "create", args });
        return {
          data: {
            spreadsheetId: "planilha-de-teste",
            spreadsheetUrl: "https://exemplo/planilha-de-teste",
            sheets: [{ properties: { sheetId: 0 } }],
          },
        };
      },

      batchUpdate: async (args) => {
        chamadas.push({ nome: "batchUpdate", args });
        const replies = [];

        for (const r of args.requestBody.requests) {
          if (r.addSheet) {
            const properties = { ...r.addSheet.properties, sheetId: proximoId++ };
            abas.set(properties.title, properties);
            regras.set(properties.sheetId, []);
            replies.push({ addSheet: { properties } });
            continue;
          }

          if (r.addConditionalFormatRule) {
            const id = r.addConditionalFormatRule.rule.ranges[0].sheetId;
            const lista = regras.get(id) || [];
            lista.splice(
              r.addConditionalFormatRule.index ?? lista.length,
              0,
              r.addConditionalFormatRule.rule
            );
            regras.set(id, lista);
          }

          if (r.deleteConditionalFormatRule) {
            const { sheetId, index } = r.deleteConditionalFormatRule;
            const lista = regras.get(sheetId) || [];
            if (index >= lista.length) {
              throw new Error(
                `deleteConditionalFormatRule fora de faixa: aba ${sheetId}, ` +
                  `índice ${index}, existem ${lista.length}`
              );
            }
            lista.splice(index, 1);
          }

          if (r.addProtectedRange) {
            const pr = r.addProtectedRange.protectedRange;
            protecoes.set(proximaProtecao++, {
              sheetId: pr.range.sheetId,
              description: pr.description,
              unprotectedRanges: pr.unprotectedRanges || null,
              warningOnly: pr.warningOnly,
              editors: pr.editors || null,
            });
          }

          if (r.deleteProtectedRange) {
            const { protectedRangeId } = r.deleteProtectedRange;
            if (!protecoes.has(protectedRangeId)) {
              throw new Error(`deleteProtectedRange inexistente: ${protectedRangeId}`);
            }
            protecoes.delete(protectedRangeId);
          }

          replies.push({});
        }

        return { data: { replies } };
      },

      values: {
        get: async (args) => {
          chamadas.push({ nome: "values.get", args });
          return { data: { values: valores.get(args.range) || [] } };
        },
        // Anexar no fim da aba: no Google, quem acha o fim é o servidor. Aqui
        // o estado mora na faixa "Aba!A:Z", que é por onde a leitura volta.
        append: async (args) => {
          chamadas.push({ nome: "values.append", args });
          const faixa = `${String(args.range).split("!")[0]}!A:Z`;
          valores.set(faixa, [...(valores.get(faixa) || []), ...args.requestBody.values]);
          return { data: {} };
        },
        update: async (args) => {
          chamadas.push({ nome: "values.update", args });
          valores.set(args.range, args.requestBody.values);
          return { data: {} };
        },
        clear: async (args) => {
          chamadas.push({ nome: "values.clear", args });
          valores.delete(args.range);
          return { data: {} };
        },
        batchClear: async (args) => {
          chamadas.push({ nome: "values.batchClear", args });
          for (const r of args.requestBody.ranges) valores.delete(r);
          return { data: {} };
        },
        batchUpdate: async (args) => {
          chamadas.push({ nome: "values.batchUpdate", args });
          for (const d of args.requestBody.data) valores.set(d.range, d.values);
          return { data: {} };
        },
      },
    },
  };

  return { client, chamadas, abas, regras, protecoes, valores };
}

/** Ajuda a montar asserção sem repetir o mesmo `if` em quatro arquivos. */
export function criarVerificador() {
  const estado = { falhas: 0 };

  const check = (nome, condicao) => {
    if (condicao) {
      console.log(`ok   ${nome}`);
    } else {
      estado.falhas++;
      console.log(`FALHA ${nome}`);
    }
  };

  const encerrar = () => {
    console.log(
      estado.falhas === 0 ? "\ntodos os casos passaram" : `\n${estado.falhas} falha(s)`
    );
    process.exit(estado.falhas === 0 ? 0 : 1);
  };

  return { check, encerrar, estado };
}
