const DB_POSTS = "350b9f9e1ac6807b8a60dd65817feaff";
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

  var month = (event.queryStringParameters || {}).month;

  try {
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

    var extra = { sorts: [{ property: "Data post", direction: "ascending" }] };
    if (month) {
      var parts = month.split("-");
      var y = parts[0], m = parts[1];
      var ld = new Date(Number(y), Number(m), 0).getDate();
      extra.filter = {
        and: [
          { property: "Data post", date: { on_or_after: y + "-" + m + "-01" } },
          { property: "Data post", date: { on_or_before: y + "-" + m + "-" + (ld < 10 ? "0" + ld : "" + ld) } },
        ],
      };
    }

    var pp = await queryAll(DB_POSTS, token, extra);

    var posts = (pp || []).map(function (pg) {
      var p = pg.properties || {};
      var nameArr = p["Name"] && p["Name"].title;
      var clientIds = (p["Base de Clientes"] && p["Base de Clientes"].relation) || [];
      var responsaveis = (p["Responsável"] && p["Responsável"].people) || [];
      var responsavel = responsaveis.map(function(r){ return r.name || ""; }).filter(Boolean).join(", ");
      return {
        id: pg.id,
        name: (nameArr && nameArr[0] && nameArr[0].plain_text) || "-",
        status: (p["Etapa"] && p["Etapa"].select && p["Etapa"].select.name) || null,
        formato: (p["Formato"] && p["Formato"].select && p["Formato"].select.name) || null,
        data: (p["Data post"] && p["Data post"].date && p["Data post"].date.start) || null,
        responsavel: responsavel || null,
        client: clientIds.length > 0
          ? clientIds.map(function (r) { return cm[r.id] || "?"; }).join(", ")
          : "Sem cliente",
      };
    });

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
      body: JSON.stringify({ posts: posts, updatedAt: new Date().toISOString() }),
    };
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
  }
};
