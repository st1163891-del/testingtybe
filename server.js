const express = require("express");
const { spawn } = require("child_process");

const app = express();

const PORT = process.env.PORT || 10000;

const WIDTH = 48;
const HEIGHT = 27;
const FPS = 12;

const FRAME_SIZE = WIDTH * HEIGHT * 3;

let ytProcess = null;
let ffmpegProcess = null;

let sequence = 0;
let ready = false;

const frameQueue = [];
const MAX_QUEUE = 72;

function stopVideo() {
    if (ytProcess) {
        try {
            ytProcess.kill("SIGKILL");
        } catch {}
    }

    if (ffmpegProcess) {
        try {
            ffmpegProcess.kill("SIGKILL");
        } catch {}
    }

    ytProcess = null;
    ffmpegProcess = null;
}

function rgb332(buffer) {
    const output = Buffer.alloc(WIDTH * HEIGHT);

    let src = 0;
    let dst = 0;

    while (dst < output.length) {
        const r = buffer[src];
        const g = buffer[src + 1];
        const b = buffer[src + 2];

        const r3 = r >> 5;
        const g3 = g >> 5;
        const b2 = b >> 6;

        output[dst] =
            (r3 << 5) |
            (g3 << 2) |
            b2;

        src += 3;
        dst++;
    }

    return output.toString("base64");
}

function startVideo(url) {
    stopVideo();

    frameQueue.length = 0;

    sequence = 0;
    ready = false;

    ytProcess = spawn("yt-dlp", [
        "--no-playlist",
        "--no-warnings",
        "-f",
        "best[height<=360]/best",
        "-o",
        "-",
        url
    ]);

    ytProcess.on("error", error => {
        console.error("yt-dlp error:", error);
        ready = false;
    });

    ffmpegProcess = spawn("ffmpeg", [
        "-hide_banner",
        "-loglevel",
        "error",

        "-i",
        "pipe:0",

        "-an",

        "-vf",
        `fps=${FPS},scale=${WIDTH}:${HEIGHT}:flags=fast_bilinear`,

        "-f",
        "rawvideo",
        "-pix_fmt",
        "rgb24",

        "pipe:1"
    ]);

    ytProcess.stdout.pipe(ffmpegProcess.stdin);

    let buffer = Buffer.alloc(0);

    ffmpegProcess.stdout.on("data", chunk => {

        buffer = Buffer.concat([buffer, chunk]);

        while (buffer.length >= FRAME_SIZE) {

            const raw = buffer.subarray(
                0,
                FRAME_SIZE
            );

            buffer = buffer.subarray(FRAME_SIZE);

            const encoded = rgb332(raw);

            sequence++;

            frameQueue.push({
                n: sequence,
                d: encoded
            });

            if (frameQueue.length > MAX_QUEUE) {
                frameQueue.shift();
            }

            ready = true;
        }
    });

    ffmpegProcess.on("close", () => {
        console.log("FFmpeg finished");
        ready = false;
    });

    ytProcess.on("close", code => {
        console.log("yt-dlp finished:", code);
    });
}

app.get("/", (req, res) => {
    res.json({
        online: true,
        width: WIDTH,
        height: HEIGHT,
        fps: FPS,
        ready: ready,
        queued: frameQueue.length
    });
});

app.get("/start", (req, res) => {

    const url = req.query.url;

    if (!url) {
        return res.status(400).json({
            error: "Missing URL"
        });
    }

    try {
        const parsed = new URL(url);

        const allowed =
            parsed.hostname === "youtube.com" ||
            parsed.hostname === "www.youtube.com" ||
            parsed.hostname === "m.youtube.com" ||
            parsed.hostname === "youtu.be";

        if (!allowed) {
            return res.status(400).json({
                error: "Only YouTube URLs are accepted"
            });
        }
    } catch {
        return res.status(400).json({
            error: "Invalid URL"
        });
    }

    startVideo(url);

    res.json({
        started: true,
        width: WIDTH,
        height: HEIGHT,
        fps: FPS
    });
});

app.get("/frames", (req, res) => {

    let after = Number(req.query.after || 0);
    let count = Number(req.query.count || 4);

    if (!Number.isFinite(after)) {
        after = 0;
    }

    if (!Number.isFinite(count)) {
        count = 4;
    }

    count = Math.max(1, Math.min(6, Math.floor(count)));

    const result = [];

    for (const frame of frameQueue) {

        if (frame.n > after) {

            result.push(frame);

            if (result.length >= count) {
                break;
            }
        }
    }

    res.json({
        width: WIDTH,
        height: HEIGHT,
        fps: FPS,
        ready,
        frames: result
    });
});

app.get("/status", (req, res) => {

    res.json({
        ready,
        sequence,
        queued: frameQueue.length,
        width: WIDTH,
        height: HEIGHT,
        fps: FPS
    });
});

app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server listening on ${PORT}`);
});
