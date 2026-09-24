import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import pg from "pg";
import path from "path";
import { fileURLToPath } from "url";
import { crawl } from "./crawler.js";

dotenv.config();

const { Pool } = pg;

const app = express();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: {
        rejectUnauthorized: false
    },
    max: 2
});

app.use(cors());
app.use(express.json());

app.use(express.static(
    path.join(__dirname, "../public")
));

app.get("/", (req, res) => {
    res.sendFile(
        path.join(__dirname, "../public/oscadia.html")
    );
});


/* =========================
   SEARCH
========================= */

app.get("/api/search", async (req, res) => {
    try {
        const q = String(req.query.q || "").trim();

        if (!q) {
            return res.json({
                query: "",
                count: 0,
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
                    to_tsvector(
                        'simple',
                        COALESCE(title, '') || ' ' ||
                        COALESCE(description, '') || ' ' ||
                        COALESCE(content, '')
                    ),
                    plainto_tsquery('simple', $1)
                ) AS rank
            FROM pages
            WHERE
                to_tsvector(
                    'simple',
                    COALESCE(title, '') || ' ' ||
                    COALESCE(description, '') || ' ' ||
                    COALESCE(content, '')
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
        console.error("SEARCH ERROR:", error);

        res.status(500).json({
            error: "검색 서버 오류"
        });
    }
});


/* =========================
   HEALTH
========================= */

app.get("/api/health", async (req, res) => {
    try {
        const result = await pool.query("SELECT NOW()");

        res.json({
            ok: true,
            service: "OSCADIA",
            database: "connected",
            crawler: "enabled",
            time: result.rows[0].now
        });

    } catch (error) {
        console.error("DATABASE ERROR:", error);

        res.status(500).json({
            ok: false,
            error: error.message
        });
    }
});


/* =========================
   CRAWLER STATUS
========================= */

let crawlerRunning = false;
let lastCrawlerStart = null;
let lastCrawlerFinish = null;
let lastCrawlerError = null;

async function runCrawler() {

    if (crawlerRunning) {
        console.log(
            "[CRAWLER] 이미 실행 중이라 건너뜁니다."
        );
        return;
    }

    crawlerRunning = true;
    lastCrawlerStart = new Date();
    lastCrawlerError = null;

    console.log("================================");
    console.log("AUTOMATIC CRAWLER START");
    console.log("================================");

    try {

        await crawl();

        lastCrawlerFinish = new Date();

        console.log("================================");
        console.log("AUTOMATIC CRAWLER FINISHED");
        console.log("================================");

    } catch (error) {

        lastCrawlerError =
            error?.message ||
            String(error);

        console.error(
            "[CRAWLER ERROR]",
            error
        );

    } finally {

        crawlerRunning = false;
    }
}


/* =========================
   CRAWLER STATUS API
========================= */

app.get("/api/crawler", (req, res) => {

    res.json({
        enabled: true,
        running: crawlerRunning,
        lastStart: lastCrawlerStart,
        lastFinish: lastCrawlerFinish,
        lastError: lastCrawlerError
    });

});


/* =========================
   SERVER START
========================= */

const PORT =
    process.env.PORT || 10000;

app.listen(
    PORT,
    "0.0.0.0",
    () => {

        console.log(
            `OSCADIA running on port ${PORT}`
        );

        /*
         * 서버가 시작된 뒤
         * 5초 후 첫 크롤링
         */
        setTimeout(() => {
            runCrawler();
        }, 5000);

        /*
         * 서버가 살아 있는 동안
         * 30분마다 크롤링
         */
        setInterval(() => {
            runCrawler();
        }, 30 * 60 * 1000);

    }
);