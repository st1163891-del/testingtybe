const express = require("express");
const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const app = express();

const PORT = process.env.PORT || 10000;
const WIDTH = 32;
const HEIGHT = 18;
const FPS = 10;
const MAX_SECONDS = 30;

const jobs = new Map();

app.get("/", (req, res) => {
	res.send("OK");
});

app.get("/start", (req, res) => {
	const url = req.query.url;

	if (!url) {
		return res.status(400).json({ error: "missing url" });
	}

	if (!url.includes("youtube.com/") && !url.includes("youtu.be/")) {
		return res.status(400).json({ error: "invalid youtube url" });
	}

	const id = crypto.randomBytes(8).toString("hex");
	const dir = path.join("/tmp", id);
	const video = path.join(dir, "video.mp4");
	const frames = path.join(dir, "frames.rgb");

	fs.mkdirSync(dir, { recursive: true });

	jobs.set(id, {
		status: "downloading",
		dir,
		video,
		frames,
		frameCount: 0
	});

	download(url, video)
		.then(() => convert(video, frames))
		.then(frameCount => {
			const job = jobs.get(id);

			if (!job) return;

			job.status = "ready";
			job.frameCount = frameCount;

			try {
				fs.unlinkSync(video);
			} catch {}
		})
		.catch(() => {
			const job = jobs.get(id);

			if (job) {
				job.status = "error";
			}
		});

	res.json({
		id,
		width: WIDTH,
		height: HEIGHT,
		fps: FPS
	});
});

app.get("/status", (req, res) => {
	const job = jobs.get(req.query.id);

	if (!job) {
		return res.status(404).json({ error: "job not found" });
	}

	res.json({
		status: job.status,
		frames: job.frameCount
	});
});

app.get("/chunk", (req, res) => {
	const job = jobs.get(req.query.id);

	if (!job || job.status !== "ready") {
		return res.status(400).json({ error: "not ready" });
	}

	const start = Math.max(
		0,
		parseInt(req.query.start || "0")
	);

	const count = Math.min(
		10,
		Math.max(1, parseInt(req.query.count || "10"))
	);

	const frameSize = WIDTH * HEIGHT * 3;
	const file = fs.openSync(job.frames, "r");
	const result = [];

	try {
		for (let i = 0; i < count; i++) {
			const frameNumber = start + i;

			if (frameNumber >= job.frameCount) {
				break;
			}

			const buffer = Buffer.alloc(frameSize);

			fs.readSync(
				file,
				buffer,
				0,
				frameSize,
				frameNumber * frameSize
			);

			result.push(buffer.toString("base64"));
		}
	} finally {
		fs.closeSync(file);
	}

	res.json({
		start,
		frames: result
	});
});

function download(url, output) {
	return new Promise((resolve, reject) => {
		const p = spawn("yt-dlp", [
			"--no-playlist",
			"-f",
			"worst[ext=mp4]/worst",
			"--max-filesize",
			"100M",
			"-o",
			output,
			url
		]);

		p.on("close", code => {
			if (code === 0 && fs.existsSync(output)) {
				resolve();
			} else {
				reject();
			}
		});

		p.on("error", reject);
	});
}

function convert(input, output) {
	return new Promise((resolve, reject) => {
		const p = spawn("ffmpeg", [
			"-hide_banner",
			"-loglevel",
			"error",
			"-i",
			input,
			"-t",
			String(MAX_SECONDS),
			"-vf",
			`fps=${FPS},scale=${WIDTH}:${HEIGHT}`,
			"-f",
			"rawvideo",
			"-pix_fmt",
			"rgb24",
			output
		]);

		p.on("close", code => {
			if (code !== 0 || !fs.existsSync(output)) {
				reject();
				return;
			}

			const frameSize = WIDTH * HEIGHT * 3;
			const size = fs.statSync(output).size;

			resolve(Math.floor(size / frameSize));
		});

		p.on("error", reject);
	});
}

app.listen(PORT, "0.0.0.0");
