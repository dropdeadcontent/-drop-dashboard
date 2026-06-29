const DB_TAREFAS = "350b9f9e1ac680e987daf16124a0ebb8";
const DB_CLIENTES = "350b9f9e1ac6802bbfa7e7f22fe4c1cc";

const nFetch = (url, body, token) =>
  fetch(url, {
    method: "POST",
    headers: {
      Authorization: "Bearer " + token,
      "Notion-Version": "2022-06-28",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  }).then((r) => r.json());

const nGet = (url, token) =>
  fetch(url, {
    headers: {
      Authorization: "Bearer " + token,
      "Notion-Version": "2022-06-28",
    },
  }).then((r) => r.json());

const queryAll = async (db, token, extra) => {
  extra = extra || {};
  var results = [], cursor;
  do {
    var body = Object.assign({ page_size: 100 }, extra);
    if (cursor) body.start_cursor = cursor;
    var data = await nFetch(
      "https://api.notion.com/v1/databases/" + db + "/query",
      body,
      token
    );
    if (data.object === "error") throw new Error(data.message);
    results = results.concat(data.results || []);
    cursor = data.has_more ? data.next_cursor : undefined;
  } while (cursor);
  return results;
};

exports.handler = async function (event) {
  var token = process.env.NOTION_TOKEN;
  if (!token) return { statusCode: 500, body: JSON.stringify({ error: "sem token" }) };

  var mes = (event.queryStringParameters || {}).mes || "agosto";

  try {
    // Busca clientes ativos
    var cp = await queryAll(DB_CLIENTES, token, {
      filter: { property: "Status", select: { equals: "\uD83D\uDFE2 Ativo" } },
    });
    var cm = {};
    (cp || []).forEach(function (p) {
      var nome = p.properties && p.properties["Nome"] &&
        p.properties["Nome"].title && p.properties["Nome"].title[0] &&
        p.properties["Nome"].title[0].plain_text;
      if (nome) cm[p.id] = nome;
    });

    // Busca ciclos de producao (tarefas raiz do tipo CICLO PRODUCAO)
    var ciclos = await queryAll(DB_TAREFAS, token, {
      filter: {
        and: [
          { property: "To-do", rich_text: { contains: "CICLO PRODU" } },
          { property: "To-do", rich_text: { contains: mes.toUpperCase() } },
        ]
      }
    });

    // Busca todas as tarefas do mes filtrado
    var todasTarefas = await queryAll(DB_TAREFAS, token, {
      filter: {
        property: "referente a",
        select: { equals: mes }
      },
      sorts: [{ property: "Prazo", direction: "ascending" }]
    });

    var tarefas = (todasTarefas || []).map(function (pg) {
      var p = pg.properties || {};
      var nameArr = (p["To-do"] && p["To-do"].title) || [];
      var clientIds = (p["Base de Clientes"] && p["Base de Clientes"].relation) || [];
      var responsaveis = (p["Responsável"] && p["Responsável"].people) || [];
      var prazoStart = p["Prazo"] && p["Prazo"].date && p["Prazo"].date.start;
      var prazoEnd = p["Prazo"] && p["Prazo"].date && p["Prazo"].date.end;
      return {
        id: pg.id,
        name: nameArr.map(function(t){ return t.plain_text; }).join("") || "-",
        status: (p["Status"] && p["Status"].status && p["Status"].status.name) || null,
        prioridade: (p["Prioridade"] && p["Prioridade"].select && p["Prioridade"].select.name) || null,
        tipo: (p["Tipo"] && p["Tipo"].multi_select) ? p["Tipo"].multi_select.map(function(t){ return t.name; }) : [],
        prazoStart: prazoStart || null,
        prazoEnd: prazoEnd || null,
        responsavel: responsaveis.map(function(r){ return r.name || ""; }).filter(Boolean).join(", ") || null,
        clientes: clientIds.map(function (r) { return cm[r.id] || null; }).filter(Boolean),
      };
    });

    // Etapas principais (sem cliente, com numero)
    var etapas = tarefas.filter(function(t) {
      return /^\d+\.\d+/.test(t.name) || /^\d+\.0/.test(t.name);
    });

    // Por cliente: subtarefas
    var porCliente = {};
    tarefas.forEach(function(t) {
      if (t.clientes.length === 1 && !/CICLO/.test(t.name) && !/^\d+\.\d+/.test(t.name)) {
        var c = t.clientes[0];
        if (!porCliente[c]) porCliente[c] = [];
        porCliente[c].push(t);
      }
    });

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
      body: JSON.stringify({
        etapas: etapas,
        porCliente: porCliente,
        updatedAt: new Date().toISOString(),
      }),
    };
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
  }
};
