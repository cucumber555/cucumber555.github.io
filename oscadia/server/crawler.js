import dotenv from "dotenv";
import pg from "pg";
import * as cheerio from "cheerio";

dotenv.config();

const { Pool } = pg;

const pool = new Pool({
    connectionString: process.env.DATABASE_URL
});


/*
    OSCADIA 크롤러 설정
*/

const MAX_PAGES = 100;

const DELAY = 1500;

const USER_AGENT =
    "OSCADIA-Bot/1.0 (+https://oscadia.example/bot)";


/*
    시작 URL

    처음에는 네가 직접 허용한 사이트부터
    색인하는 것을 권장.
*/

const START_URLS = [
    "https://cucumber555.github.io/"
];


const visited = new Set();

const queue = [...START_URLS];


/*
    robots.txt

    간단한 robots.txt 확인.
*/

async function canCrawl(url) {

    try {

        const parsed = new URL(url);

        const robotsURL =
            `${parsed.origin}/robots.txt`;

        const response = await fetch(
            robotsURL,
            {
                headers: {
                    "User-Agent": USER_AGENT
                }
            }
        );

        if (!response.ok) {

            return true;

        }

        const text =
            await response.text();

        const lines =
            text.split(/\r?\n/);

        let applies = false;

        for (const raw of lines) {

            const line =
                raw.trim();

            if (!line) continue;

            const lower =
                line.toLowerCase();

            if (lower.startsWith("user-agent:")) {

                const agent =
                    line
                        .split(":")[1]
                        ?.trim()
                        .toLowerCase();

                applies =
                    agent === "*" ||
                    agent === "oscadia-bot";

            }

            if (
                applies &&
                lower.startsWith("disallow:")
            ) {

                const path =
                    line
                        .split(":")
                        .slice(1)
                        .join(":")
                        .trim();

                if (!path) continue;

                if (
                    parsed.pathname
                    .startsWith(path)
                ) {

                    return false;

                }

            }

        }

        return true;

    } catch {

        return false;

    }

}


/*
    URL 정리
*/

function normalizeURL(url, base) {

    try {

        const absolute =
            new URL(url, base);

        if (
            absolute.protocol !== "http:" &&
            absolute.protocol !== "https:"
        ) {

            return null;

        }

        absolute.hash = "";

        return absolute.href;

    } catch {

        return null;

    }

}


/*
    페이지 크롤링
*/

async function crawl(url) {

    if (visited.has(url)) {

        return [];

    }

    if (visited.size >= MAX_PAGES) {

        return [];

    }

    visited.add(url);

    console.log("Crawling:", url);


    if (!(await canCrawl(url))) {

        console.log(
            "robots.txt blocked:",
            url
        );

        return [];

    }


    try {

        const response =
            await fetch(
                url,
                {
                    headers: {
                        "User-Agent": USER_AGENT
                    },
                    redirect: "follow"
                }
            );


        const contentType =
            response.headers.get(
                "content-type"
            ) || "";


        if (
            !contentType.includes("text/html")
        ) {

            return [];

        }


        if (!response.ok) {

            return [];

        }


        const html =
            await response.text();


        const $ =
            cheerio.load(html);


        /*
            불필요한 요소 제거
        */

        $("script").remove();

        $("style").remove();

        $("noscript").remove();

        $("svg").remove();


        const title =
            $("title")
                .first()
                .text()
                .trim();


        const description =
            $('meta[name="description"]')
                .attr("content") || "";


        const content =
            $("body")
                .text()
                .replace(/\s+/g, " ")
                .trim()
                .slice(0, 100000);


        const domain =
            new URL(url).hostname;


        /*
            DB에 저장
        */

        await pool.query(
            `
            INSERT INTO pages
                (
                    url,
                    title,
                    description,
                    content,
                    domain,
                    last_crawled
                )
            VALUES
                ($1,$2,$3,$4,$5,NOW())

            ON CONFLICT(url)

            DO UPDATE SET

                title = EXCLUDED.title,

                description =
                    EXCLUDED.description,

                content =
                    EXCLUDED.content,

                domain =
                    EXCLUDED.domain,

                last_crawled =
                    NOW()
            `,
            [
                url,
                title,
                description,
                content,
                domain
            ]
        );


        /*
            페이지 안의 링크 발견
        */

        const links = [];


        $("a[href]").each(
            (_, element) => {

                const href =
                    $(element)
                        .attr("href");

                const next =
                    normalizeURL(
                        href,
                        url
                    );

                if (!next) return;


                /*
                    일단 같은 도메인만
                    따라가도록 제한
                */

                try {

                    if (
                        new URL(next).hostname ===
                        new URL(url).hostname
                    ) {

                        links.push(next);

                    }

                } catch {}

            }
        );


        return [
            ...new Set(links)
        ];


    } catch (error) {

        console.error(
            "Crawler error:",
            url,
            error.message
        );

        return [];

    }

}


/*
    크롤러 실행
*/

async function main() {

    while (
        queue.length > 0 &&
        visited.size < MAX_PAGES
    ) {

        const url =
            queue.shift();


        const links =
            await crawl(url);


        for (const link of links) {

            if (
                !visited.has(link) &&
                !queue.includes(link) &&
                visited.size + queue.length <
                MAX_PAGES
            ) {

                queue.push(link);

            }

        }


        /*
            서버에 부담을 주지 않도록
            요청 사이에 대기
        */

        await new Promise(
            resolve =>
                setTimeout(
                    resolve,
                    DELAY
                )
        );

    }


    console.log(
        `Crawl finished. ${visited.size} pages visited.`
    );


    await pool.end();

}


main();