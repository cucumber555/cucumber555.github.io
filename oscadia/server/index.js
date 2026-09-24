import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import pg from "pg";
import path from "path";
import { fileURLToPath } from "url";

process.on("uncaughtException", (error) => {
    console.error("UNCAUGHT EXCEPTION:");
    console.error(error);
});

process.on("unhandledRejection", (error) => {
    console.error("UNHANDLED REJECTION:");
    console.error(error);
});
dotenv.config();

const { Pool } = pg;

const app = express();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

console.log(
    "DB CONFIG:",
    process.env.DATABASE_URL
        ? process.env.DATABASE_URL.replace(/:[^:@]+@/, ":****@")
        : "DATABASE_URL 없음"
);
const pool = new Pool({
    connectionString: process.env.DATABASE_URL
});

app.use(cors());
app.use(express.json());

app.use(express.static(
    path.join(__dirname, "../public")
));


/*
    홈페이지
*/

app.get("/", (req, res) => {

    res.sendFile(
        path.join(__dirname, "../public/oscadia.html")
    );

});


/*
    검색 API

    GET /api/search?q=검색어
*/

app.get("/api/search", async (req, res) => {

    try {

        const q = String(req.query.q || "").trim();

        if (!q) {

            return res.json({
                results: []
            });

        }

        if (q.length > 200) {

            return res.status(400).json({
                error: "검색어가 너무 깁니다."
            });

        }


        const query = `
            SELECT
                id,
                url,
                title,
                description,
                domain,
                ts_rank(
                    to_tsvector('simple',
                        title || ' ' ||
                        description || ' ' ||
                        content
                    ),
                    plainto_tsquery('simple', $1)
                ) AS rank
            FROM pages
            WHERE
                to_tsvector(
                    'simple',
                    title || ' ' ||
                    description || ' ' ||
                    content
                )
                @@ plainto_tsquery('simple', $1)

            ORDER BY rank DESC, last_crawled DESC

            LIMIT 50
        `;

        const result = await pool.query(query, [q]);

        res.json({
            query: q,
            count: result.rows.length,
            results: result.rows
        });

    } catch (error) {

        console.error(error);

        res.status(500).json({
            error: "검색 서버 오류"
        });

    }

});


/*
    서버 상태 확인
*/

app.get("/api/health", async (req, res) => {
    try {
        console.log("DATABASE_URL exists:", !!process.env.DATABASE_URL);

        const result = await pool.query("SELECT NOW()");

        res.json({
            ok: true,
            service: "OSCADIA",
            database: "connected",
            time: result.rows[0].now
        });

    } catch (error) {

        console.error("DATABASE ERROR:", error);

        res.status(500).json({
            ok: false,
            service: "OSCADIA",
            database: "connection failed",
            error: error.message,
            code: error.code || null
        });
    }
});
const PORT = process.env.PORT || 10000;

app.listen(PORT, "0.0.0.0", () => {
    console.log(`OSCADIA running on port ${PORT}`);
});