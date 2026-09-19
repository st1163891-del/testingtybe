FROM node:22-bookworm

RUN apt-get update \
    && apt-get install -y ffmpeg python3 python3-pip curl unzip \
    && pip3 install --break-system-packages -U "yt-dlp[default]" \
    && curl -fsSL https://deno.land/install.sh | sh \
    && ln -s /root/.deno/bin/deno /usr/local/bin/deno \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json* ./

RUN npm install

COPY server.js .

EXPOSE 10000

CMD ["npm", "start"]
