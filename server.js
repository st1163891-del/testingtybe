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
let lastError = "";

const frameQueue = [];

function stopVideo() {
    if (ytProcess) {
        try { ytProcess.kill("SIGKILL"); } catch {}
    }

    if (ffmpegProcess) {
        try { ffmpegProcess.kill("SIGKILL"); } catch {}
    }

    ytProcess = null;
    ffmpegProcess = null;
}

function rgb332(buffer) {
    const output = Buffer.alloc(WIDTH * HEIGHT);

    let src = 0;

    for (let i = 0; i < output.length; i++) {
        const r = buffer[src];
        const g = buffer[src + 1];
        const b = buffer[src + 2];

        output[i] =
            ((r >> 5) << 5) |
            ((g >> 5) << 2) |
            (b >> 6);

        src += 3;
    }

    return output.toString("base64");
}

function startVideo(url) {
    stopVideo();

    frameQueue.length = 0;
    sequence = 0;
    ready = false;
    lastError = "";

    console.log("================================");
    console.log("STARTING VIDEO");
    console.log(url);
    console.log("================================");

    ytProcess = spawn("yt-dlp", [
        "--no-playlist",
        "--no-warnings",
        "-f",
        "best[height<=360]/best",
        "-o",
        "-",
        url
    ]);

    ytProcess.stderr.on("data", data => {
        const text = data.toString();
        console.log("[yt-dlp]", text);

        lastError = text;
    });

    ytProcess.on("error", error => {
        console.error("[yt-dlp ERROR]", error);
        lastError = error.toString();
    });

    ytProcess.on("close", code => {
        console.log("[yt-dlp CLOSED]", code);
    });

    ffmpegProcess = spawn("ffmpeg", [
        "-hide_banner",
        "-loglevel",
        "warning",
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

    ffmpegProcess.stderr.on("data", data => {
        const text = data.toString();
        console.log("[FFMPEG]", text);

        lastError = text;
    });

    ffmpegProcess.on("error", error => {
        console.error("[FFMPEG ERROR]", error);
        lastError = error.toString();
    });

    ffmpegProcess.on("close", code => {
        console.log("[FFMPEG CLOSED]", code);
        ready = false;
    });

    ytProcess.stdout.pipe(ffmpegProcess.stdin);

    let buffer = Buffer.alloc(0);

    ffmpegProcess.stdout.on("data", chunk => {

        buffer = Buffer.concat([
            buffer,
            chunk
        ]);

        while (buffer.length >= FRAME_SIZE) {

            const raw =
                buffer.subarray(
                    0,
                    FRAME_SIZE
                );

            buffer =
                buffer.subarray(
                    FRAME_SIZE
                );

            sequence++;

            frameQueue.push({
                n: sequence,
                d: rgb332(raw)
            });

            if (frameQueue.length > 72) {
                frameQueue.shift();
            }

            ready = true;

            console.log(
                "FRAME",
                sequence
            );
        }
    });
}

app.get("/", (req, res) => {
    res.json({
        online: true,
        width: WIDTH,
        height: HEIGHT,
        fps: FPS
    });
});

app.get("/start", (req, res) => {

    let url = req.query.url;

    if (Array.isArray(url)) {
        url = url[0];
    }

    if (!url) {
        return res.status(400).json({
            ok: false,
            error: "Missing URL"
        });
    }

    url = String(url).trim();

    console.log("START REQUEST:", url);

    startVideo(url);

    res.json({
        ok: true,
        started: true
    });
});

app.get("/frames", (req, res) => {

    let after =
        Number(req.query.after || 0);

    let count =
        Number(req.query.count || 4);

    count =
        Math.max(
            1,
            Math.min(6, Math.floor(count))
        );

    const frames = [];

    for (const frame of frameQueue) {

        if (frame.n > after) {

            frames.push(frame);

            if (frames.length >= count) {
                break;
            }
        }
    }

    res.json({
        ready: ready,
        sequence: sequence,
        width: WIDTH,
        height: HEIGHT,
        fps: FPS,
        frames: frames
    });
});

app.get("/status", (req, res) => {

    res.json({
        ready: ready,
        sequence: sequence,
        queued: frameQueue.length,
        error: lastError
    });
});

app.listen(
    PORT,
    "0.0.0.0",
    () => {
        console.log(
            "Server running on port " + PORT
        );
    }
);
