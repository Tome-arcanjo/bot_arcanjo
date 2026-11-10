import crypto from "crypto";
import fs from "fs/promises";
import path from "path";
import { spawn } from "child_process";
import { v4 as uuidv4 } from "uuid";

/**
 * Anexos das conversas (imagens, áudios, vídeos, documentos e figurinhas).
 *
 * Os arquivos ficam no disco do servidor, em MEDIA_DIR (padrão "data/media",
 * relativo à pasta onde o app roda — no PM2, a raiz do projeto). No banco só
 * vai a descrição (messages.media). O painel lê pelo GET autenticado
 * /api/conversas/media/:messageId — nada aqui é público.
 *
 * Os tipos e limites seguem o que a Cloud API aceita:
 * https://developers.facebook.com/docs/whatsapp/cloud-api/reference/media#supported-media-types
 */

const MEDIA_DIR = path.resolve(process.env.MEDIA_DIR || "data/media");
const MB = 1024 * 1024;

// Maior arquivo que o painel aceita (o limite de cada tipo vem abaixo).
export const MAX_UPLOAD_BYTES = 25 * MB;

const RULES = {
  image: { mimes: ["image/jpeg", "image/png"], max: 5 * MB, label: "Imagem" },
  sticker: { mimes: ["image/webp"], max: 500 * 1024, label: "Figurinha" },
  audio: { mimes: ["audio/ogg", "audio/mpeg", "audio/mp4", "audio/aac", "audio/amr"], max: 16 * MB, label: "Áudio" },
  video: { mimes: ["video/mp4", "video/3gpp"], max: 16 * MB, label: "Vídeo" },
  document: { mimes: null, max: MAX_UPLOAD_BYTES, label: "Documento" },
};

export const MEDIA_TYPES = Object.keys(RULES);
export const mediaLabel = (type) => RULES[type]?.label || "Arquivo";

const EXTENSIONS = {
  "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif",
  "audio/ogg": "ogg", "audio/mpeg": "mp3", "audio/mp4": "m4a", "audio/aac": "aac", "audio/amr": "amr",
  "video/mp4": "mp4", "video/3gpp": "3gp", "application/pdf": "pdf",
};

// Tipos que o navegador pode abrir direto no painel. Todo o resto (HTML,
// SVG, scripts...) é servido só como download — um cliente poderia mandar
// um HTML malicioso como "documento".
const INLINE_SAFE = /^(image\/(jpeg|png|webp|gif)|audio\/|video\/(mp4|3gpp|webm)|application\/pdf$)/;

export class MediaError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

/** "audio/ogg; codecs=opus" -> "audio/ogg" */
export function baseMime(mime) {
  return String(mime || "application/octet-stream").split(";")[0].trim().toLowerCase();
}

/**
 * Converte o áudio gravado no navegador para OGG/Opus (o formato de áudio de
 * voz do WhatsApp). O Chrome grava em WebM, que a Meta não aceita. Precisa do
 * ffmpeg no servidor (apt install ffmpeg).
 */
function convertToOgg(buffer) {
  return new Promise((resolve, reject) => {
    const ffmpeg = spawn("ffmpeg", ["-hide_banner", "-loglevel", "error", "-i", "pipe:0", "-vn", "-c:a", "libopus", "-b:a", "32k", "-f", "ogg", "pipe:1"]);
    const chunks = [];
    let stderr = "";
    ffmpeg.stdout.on("data", (c) => chunks.push(c));
    ffmpeg.stderr.on("data", (c) => (stderr += c));
    ffmpeg.on("error", (err) =>
      reject(
        err.code === "ENOENT"
          ? new MediaError("Este navegador grava áudio em WebM, que o WhatsApp não aceita, e o servidor não tem o ffmpeg para converter (apt install ffmpeg).", 415)
          : err
      )
    );
    ffmpeg.on("close", (code) =>
      code === 0 ? resolve(Buffer.concat(chunks)) : reject(new MediaError(`Não foi possível converter o áudio: ${stderr.trim() || code}`, 422))
    );
    ffmpeg.stdin.on("error", () => {}); // o ffmpeg pode fechar a entrada antes do fim em caso de erro
    ffmpeg.stdin.end(buffer);
  });
}

/**
 * Decide o tipo de mensagem do WhatsApp para um arquivo enviado pelo painel
 * e valida o tamanho. Áudios fora dos formatos aceitos são convertidos.
 * @param {Buffer} buffer
 * @param {{ mime: string, name?: string, kind?: "sticker"|"voice"|"document" }} opts
 * @returns {Promise<{ type: string, buffer: Buffer, mime: string, name: string }>}
 */
export async function prepareUpload(buffer, { mime, name, kind } = {}) {
  if (!buffer?.length) throw new MediaError("Arquivo vazio.");
  let type;
  let finalMime = baseMime(mime);
  let finalBuffer = buffer;
  let finalName = String(name || "").trim().slice(0, 200) || `arquivo.${EXTENSIONS[finalMime] || "bin"}`;

  if (kind === "sticker") {
    if (finalMime !== "image/webp") throw new MediaError("Figurinha precisa ser uma imagem WebP (512×512).");
    type = "sticker";
  } else if (kind === "document") {
    type = "document";
  } else if (RULES.image.mimes.includes(finalMime)) {
    type = "image";
  } else if (RULES.video.mimes.includes(finalMime)) {
    type = "video";
  } else if (finalMime.startsWith("audio/") || (kind === "voice" && finalMime.startsWith("video/webm"))) {
    const opus = /codecs=.*opus/i.test(String(mime));
    if (!RULES.audio.mimes.includes(finalMime) || (finalMime === "audio/mp4" && opus)) {
      finalBuffer = await convertToOgg(buffer);
      finalMime = "audio/ogg";
      finalName = finalName.replace(/\.[^.]+$/, "") + ".ogg";
    }
    type = "audio";
  } else {
    type = "document";
  }

  const rule = RULES[type];
  if (finalBuffer.length > rule.max) {
    throw new MediaError(`${rule.label} grande demais: o WhatsApp aceita até ${Math.round(rule.max / MB) || "0,5"} MB.`, 413);
  }
  return { type, buffer: finalBuffer, mime: finalMime, name: finalName };
}

/** Grava o arquivo e devolve a descrição que vai em messages.media. */
export async function saveMedia(buffer, { mime, name, caption = null, waId = null }) {
  const cleanMime = baseMime(mime);
  const month = new Date().toISOString().slice(0, 7);
  const rel = `${month}/${uuidv4()}.${EXTENSIONS[cleanMime] || "bin"}`;
  await fs.mkdir(path.join(MEDIA_DIR, month), { recursive: true });
  await fs.writeFile(path.join(MEDIA_DIR, rel), buffer);
  return {
    path: rel,
    mime: cleanMime,
    name: name || path.basename(rel),
    size: buffer.length,
    sha256: crypto.createHash("sha256").update(buffer).digest("hex"),
    caption: caption || null,
    waId,
  };
}

/** Caminho absoluto do arquivo, sem deixar sair de MEDIA_DIR. */
export function mediaFilePath(media) {
  if (!media?.path) return null;
  const abs = path.resolve(MEDIA_DIR, media.path);
  return abs.startsWith(MEDIA_DIR + path.sep) ? abs : null;
}

export async function readMedia(media) {
  const abs = mediaFilePath(media);
  if (!abs) throw new MediaError("Anexo sem arquivo.", 404);
  try {
    return await fs.readFile(abs);
  } catch {
    throw new MediaError("Arquivo do anexo não encontrado no servidor.", 404);
  }
}

export function isInlineSafe(mime) {
  return INLINE_SAFE.test(baseMime(mime));
}
