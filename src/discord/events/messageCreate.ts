import { ChannelType, type Message, type Attachment } from "discord.js";
import { exec } from "child_process";
import sharp from "sharp";
import type { AppConfig, ImageContent, PendingImage, AudioTranscription } from "../../types.js";
import { getConfig } from "../../config.js";
import type { SessionManager } from "../../claude/sessionManager.js";
import { isAudioFile, transcribeAudio } from "../../utils/audioTranscriber.js";

const SUPPORTED_IMAGE_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"];
const MAX_IMAGE_SIZE_BYTES = 5 * 1024 * 1024; // 5MB limit for Claude API
const MAX_IMAGE_DIMENSION = 1568; // Claude API max dimension limit

async function fetchImageAsBase64(url: string): Promise<{ data: string; mediaType: string } | null> {
  try {
    const response = await fetch(url);
    if (!response.ok) return null;

    const contentType = response.headers.get("content-type") || "";
    let mediaType = contentType.split(";")[0].trim();

    if (!SUPPORTED_IMAGE_TYPES.includes(mediaType)) return null;

    const buffer = Buffer.from(await response.arrayBuffer());

    // Resize image if needed
    const resized = await resizeImageIfNeeded(buffer, mediaType);

    return { data: resized.data, mediaType: resized.mediaType };
  } catch (err) {
    console.error("[Image] Error fetching/processing image:", err);
    return null;
  }
}

async function resizeImageIfNeeded(
  buffer: Buffer,
  mediaType: string
): Promise<{ data: string; mediaType: string }> {
  try {
    const image = sharp(buffer);
    const metadata = await image.metadata();

    const width = metadata.width || 0;
    const height = metadata.height || 0;

    // Check if resize is needed
    if (width <= MAX_IMAGE_DIMENSION && height <= MAX_IMAGE_DIMENSION) {
      // No resize needed, return original
      return { data: buffer.toString("base64"), mediaType };
    }

    console.log(`[Image] Resizing image from ${width}x${height} to fit within ${MAX_IMAGE_DIMENSION}px`);

    // Calculate new dimensions maintaining aspect ratio
    let newWidth: number;
    let newHeight: number;

    if (width > height) {
      newWidth = MAX_IMAGE_DIMENSION;
      newHeight = Math.round((height / width) * MAX_IMAGE_DIMENSION);
    } else {
      newHeight = MAX_IMAGE_DIMENSION;
      newWidth = Math.round((width / height) * MAX_IMAGE_DIMENSION);
    }

    // Resize and convert to appropriate format
    let resizedBuffer: Buffer;
    let outputMediaType = mediaType;

    if (mediaType === "image/png") {
      resizedBuffer = await image
        .resize(newWidth, newHeight, { fit: "inside", withoutEnlargement: true })
        .png({ quality: 90, compressionLevel: 9 })
        .toBuffer();
    } else if (mediaType === "image/gif") {
      // For GIF, convert to PNG to avoid animation issues
      resizedBuffer = await image
        .resize(newWidth, newHeight, { fit: "inside", withoutEnlargement: true })
        .png()
        .toBuffer();
      outputMediaType = "image/png";
    } else {
      // JPEG and WebP
      resizedBuffer = await image
        .resize(newWidth, newHeight, { fit: "inside", withoutEnlargement: true })
        .jpeg({ quality: 85 })
        .toBuffer();
      outputMediaType = "image/jpeg";
    }

    console.log(`[Image] Resized to ${newWidth}x${newHeight}, size: ${(resizedBuffer.length / 1024).toFixed(1)}KB`);

    // Check if still too large after resize
    if (resizedBuffer.length > MAX_IMAGE_SIZE_BYTES) {
      console.log(`[Image] Still too large after resize: ${(resizedBuffer.length / 1024 / 1024).toFixed(2)}MB, trying JPEG compression`);
      // Try more aggressive JPEG compression
      resizedBuffer = await sharp(resizedBuffer)
        .jpeg({ quality: 70 })
        .toBuffer();
      outputMediaType = "image/jpeg";
      console.log(`[Image] After JPEG compression: ${(resizedBuffer.length / 1024).toFixed(1)}KB`);
    }

    return { data: resizedBuffer.toString("base64"), mediaType: outputMediaType };
  } catch (err) {
    console.error("[Image] Resize error, using original:", err);
    // Fallback to original if resize fails
    return { data: buffer.toString("base64"), mediaType };
  }
}

interface ExtractedMedia {
  images: ImageContent[];
  pendingImages: PendingImage[];
  audioTranscriptions: AudioTranscription[];
}

async function extractMedia(message: Message): Promise<ExtractedMedia> {
  const images: ImageContent[] = [];
  const pendingImages: PendingImage[] = [];
  const audioTranscriptions: AudioTranscription[] = [];
  let imageIndex = 0;

  // Extract from attachments
  for (const attachment of message.attachments.values()) {
    const contentType = attachment.contentType || "";
    const filename = attachment.name || "unknown";

    // Debug logging for attachments
    console.log(`[Attachment] name: ${filename}, contentType: ${contentType}, waveform: ${!!attachment.waveform}, duration: ${attachment.duration}, flags: ${message.flags.bitfield}`);

    // Check for audio files (including Discord voice messages which have waveform)
    const isVoiceMessage = !!attachment.waveform || !!attachment.duration;
    if (isAudioFile(contentType, filename) || isVoiceMessage) {
      console.log(`[Audio] Processing audio file: ${filename}, isVoiceMessage: ${isVoiceMessage}`);
      const transcription = await transcribeAudio(attachment.url, filename);
      if (transcription) {
        console.log(`[Audio] Transcription successful: "${transcription.text.substring(0, 50)}..."`);
        audioTranscriptions.push(transcription);
      } else {
        console.log(`[Audio] Transcription failed for ${filename}`);
      }
      continue;
    }

    // Check for image files
    if (SUPPORTED_IMAGE_TYPES.includes(contentType)) {
      // Always try to process - we'll resize large images
      console.log(`[Image] Processing image: ${filename} (${(attachment.size / 1024 / 1024).toFixed(2)}MB)`);

      const result = await fetchImageAsBase64(attachment.url);
      if (result) {
        images.push({ type: "image", data: result.data, mediaType: result.mediaType });
        pendingImages.push({
          index: imageIndex,
          url: attachment.url,
          filename: filename || `image_${imageIndex}.${result.mediaType.split("/")[1]}`,
          data: result.data,
          mediaType: result.mediaType,
        });
        imageIndex++;
      }
    }
  }

  // Extract image URLs from message content
  const urlRegex = /(https?:\/\/[^\s]+\.(?:png|jpg|jpeg|gif|webp)(?:\?[^\s]*)?)/gi;
  const urls = message.content.match(urlRegex) || [];

  for (const url of urls) {
    const result = await fetchImageAsBase64(url);
    if (result) {
      images.push({ type: "image", data: result.data, mediaType: result.mediaType });
      // Extract filename from URL
      const urlPath = new URL(url).pathname;
      const filename = urlPath.split("/").pop() || `image_${imageIndex}.${result.mediaType.split("/")[1]}`;
      pendingImages.push({
        index: imageIndex,
        url,
        filename,
        data: result.data,
        mediaType: result.mediaType,
      });
      imageIndex++;
    }
  }

  return { images, pendingImages, audioTranscriptions };
}

export function handleMessageCreate(_config: AppConfig, sessionManager: SessionManager) {
  return async (message: Message) => {
    // Ignore bot messages
    if (message.author.bot) return;

    // Only handle messages in threads
    if (
      message.channel.type !== ChannelType.PublicThread &&
      message.channel.type !== ChannelType.PrivateThread
    ) {
      return;
    }

    const thread = message.channel;
    const parentId = thread.parentId ?? "";

    // Get fresh config for hot-reload support
    const config = getConfig();

    // Check if this is a subsession thread (thread name starts with "[Sub:")
    const isSubsessionThread = thread.name.startsWith("[Sub:");

    // Get project path - either from channel map or from existing session (for subsessions)
    let projectPath = config.channel_project_map[parentId];

    // For subsession threads, get project path from the existing session
    if (!projectPath && isSubsessionThread) {
      const existingSession = sessionManager.getSession(thread.id);
      if (existingSession) {
        projectPath = existingSession.projectPath;
      }
    }

    if (!projectPath) return;

    // Check user whitelist
    if (config.allowed_users.length > 0 && !config.allowed_users.includes(message.author.id)) {
      return;
    }

    const content = message.content.trim();
    const { images, pendingImages, audioTranscriptions } = await extractMedia(message);

    // Need either text, images, or audio
    if (!content && images.length === 0 && audioTranscriptions.length === 0) return;

    // Handle special commands
    if (content === "!stop") {
      await sessionManager.stopSession(thread.id, thread);
      return;
    }

    if (content === "!cost") {
      await sessionManager.getCost(thread.id, thread);
      return;
    }

    // Handle image save command: !save [index] [path]
    const saveMatch = content.match(/^!save\s+(\d+)\s+(.+)$/i);
    if (saveMatch) {
      const imageIndex = parseInt(saveMatch[1], 10);
      const targetPath = saveMatch[2].trim();
      await sessionManager.saveImage(thread.id, imageIndex, targetPath, thread);
      return;
    }

    // Handle image list command
    if (content === "!images") {
      const list = sessionManager.listPendingImages(thread.id);
      await thread.send(`*${list}*`);
      return;
    }

    // Handle deploy/restart commands (only for claude-with-discord project)
    const reloadCommands = ["!reload", "!restart", "!deploy", "재시작", "리로드"];
    if (reloadCommands.includes(content.toLowerCase()) && projectPath.includes("claude-with-discord")) {
      await message.reply("🔄 Deploying...");
      exec("/Volumes/T7/projects/claude-with-discord/scripts/deploy.sh", (error, stdout, stderr) => {
        if (error) {
          thread.send(`❌ Deploy failed:\n\`\`\`\n${stderr || error.message}\n\`\`\``);
        } else {
          thread.send(`✅ Deploy successful:\n\`\`\`\n${stdout}\n\`\`\``);
        }
      });
      return;
    }

    // Forward to Claude Code
    await sessionManager.sendMessage(
      thread.id,
      parentId,
      projectPath,
      content,
      thread,
      images,
      pendingImages,
      audioTranscriptions,
      message,
    );
  };
}
