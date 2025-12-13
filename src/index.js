function generateCardId() {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let id = "";
  for (let i = 0; i < 6; i++) {
    id += chars[Math.floor(Math.random() * chars.length)];
  }
  return id;
}

function corsResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,HEAD,POST,DELETE,OPTIONS",
      "Access-Control-Allow-Headers": "*",
      "Content-Type": "application/json"
    }
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const method = request.method;
    const pathname = url.pathname;
    const secretKey = "DEL-9f2b7d41-a8c3-4c79-9e5a-32f80bf1d4e3";

    // ====================== CORS (OPTIONS) ======================
    if (method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET,HEAD,POST,DELETE,OPTIONS",
          "Access-Control-Allow-Headers": "*"
        }
      });
    }

    // ============================================================
    //          GET LIST OF CARDS  (GET /api/cards)
    // ============================================================
    if (pathname === "/api/cards" && method === "GET") {
      const result = await env.DB.prepare(
        "SELECT id, cardId, name, createdAt FROM cards ORDER BY createdAt DESC"
      ).all();

      return corsResponse(result.results);
    }

    // ============================================================
    //            CREATE CARD (POST /api/cards/create)
    // ============================================================
    if (pathname === "/api/cards/create" && method === "POST") {
      const body = await request.json();
      const name = body.name || "Unnamed Card";
      let cardId = body.cardId; // cardId người dùng nhập

      // Nếu người dùng có nhập cardId thì kiểm tra trùng
      if (cardId) {
        const exists = await env.DB.prepare(
          "SELECT cardId FROM cards WHERE cardId = ?"
        )
          .bind(cardId)
          .first();

        if (exists) {
          return corsResponse({
            success: false,
            message: "cardId đã tồn tại, vui lòng chọn cardId khác.",
          });
        }
      } else {
        // Nếu không nhập → tự tạo cardId không trùng
        while (true) {
          const tempId = generateCardId();
          const exists = await env.DB.prepare(
            "SELECT cardId FROM cards WHERE cardId = ?"
          )
            .bind(tempId)
            .first();

          if (!exists) {
            cardId = tempId;
            break;
          }
        }
      }

      // Lưu database
      await env.DB.prepare(
        "INSERT INTO cards (cardId, name) VALUES (?, ?)"
      )
        .bind(cardId, name)
        .run();

      return corsResponse({
        success: true,
        cardId,
        name,
      });
    }


    // ============================================================
    //          VERIFY CARD ID  (GET /api/cards/verify/:cardId)
    // ============================================================
    const verifyMatch = pathname.match(/^\/api\/cards\/verify\/([^\/]+)$/);
    if (verifyMatch && method === "GET") {
      const cardId = verifyMatch[1];

      const result = await env.DB.prepare(
        "SELECT 1 FROM cards WHERE cardId = ?"
      ).bind(cardId).first();

      return corsResponse({ valid: !!result });
    }

    // ============================================================
    //          ROUTES LIÊN QUAN TỚI CARD (RSVP + MESSAGES)
    // ============================================================
    const match = pathname.match(/^\/api\/cards\/([^\/]+)\/?(.*)?$/);
    if (!match) return corsResponse({ error: "Not Found" }, 404);

    const cardId = match[1];
    const subPath = "/" + (match[2] || "");

    // ====================== VERIFY cardId EXISTS ======================
    const cardExists = await env.DB.prepare(
      "SELECT 1 FROM cards WHERE cardId = ?"
    ).bind(cardId).first();

    if (!cardExists) {
      return corsResponse({ error: "cardId không tồn tại!" }, 404);
    }

    // ====================== RSVP POST ======================
    if (subPath === "/rsvp" && method === "POST") {
      const data = await request.json();
      const { name, phone, isComing, guestCount, guestOf } = data;

      await env.DB.prepare(
        `INSERT INTO rsvp (cardId, name, phone, isComing, guestCount, guestOf)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
        .bind(cardId, name, phone, isComing ? 1 : 0, guestCount || 1, guestOf || null)
        .run();

      return corsResponse({ success: true });
    }

    // ====================== RSVP GET ======================
    if (subPath === "/rsvp" && method === "GET") {
      const result = await env.DB.prepare(
        "SELECT * FROM rsvp WHERE cardId = ? ORDER BY createdAt DESC"
      ).bind(cardId).all();

      return corsResponse(result.results);
    }

    // ====================== MESSAGE POST ======================
    if (subPath === "/messages" && method === "POST") {
      const data = await request.json();
      const { name, message } = data;

      await env.DB.prepare(
        "INSERT INTO messages (cardId, name, message) VALUES (?, ?, ?)"
      )
        .bind(cardId, name, message)
        .run();

      return corsResponse({ success: true });
    }

    // ====================== MESSAGE GET ======================
    if (subPath === "/messages" && method === "GET") {
      const result = await env.DB.prepare(
        `SELECT id, name, message, reply, createdAt
          FROM messages
          WHERE cardId = ?
          ORDER BY createdAt DESC`
      ).bind(cardId).all();


      return corsResponse(result.results);
    }

    // ====================== DELETE ALL MESSAGES ======================
    if (subPath === "/messages" && method === "DELETE") {
      const secret = url.searchParams.get("secret");

      if (secret !== secretKey) {
        return corsResponse({ error: "Sai mã bảo vệ!" }, 403);
      }

      await env.DB.prepare(
        "DELETE FROM messages WHERE cardId = ?"
      )
        .bind(cardId)
        .run();

      return corsResponse({ success: true, message: "Đã xoá tất cả lời chúc." });
    }

    // ====================== DELETE ONE MESSAGE ======================
    if (subPath.startsWith("/messages/") && method === "DELETE") {
      const secret = url.searchParams.get("secret");

      if (secret !== secretKey) {
        return corsResponse({ error: "Sai mã bảo vệ!" }, 403);
      }

      const messageId = subPath.split("/")[2];

      await env.DB.prepare(
        "DELETE FROM messages WHERE id = ? AND cardId = ?"
      )
        .bind(messageId, cardId)
        .run();

      return corsResponse({ success: true, message: `Đã xoá lời chúc #${messageId}` });
    }

    // ====================== ADMIN REPLY ======================
    if (subPath === "/messages/reply" && method === "POST") {
      const adminId = url.searchParams.get("id");

      if (adminId !== "admin") {
        return corsResponse({ error: "Unauthorized" }, 403);
      }

      const body = await request.json();
      const { messageId, reply } = body;

      await env.DB.prepare(
        "UPDATE messages SET reply = ? WHERE id = ? AND cardId = ?"
      )
        .bind(reply, messageId, cardId)
        .run();

      return corsResponse({ success: true });
    }

    return corsResponse({ error: "Not Found" }, 404);
  }
};
