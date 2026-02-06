import express from "express";
import dotenv from "dotenv";
import cors from "cors";
import { connectDB } from "./config/db.js";
import fetch from "node-fetch";
import { google } from "googleapis";
import { XMLParser } from "fast-xml-parser";

dotenv.config();

const app = express();

app.use(
  cors({
    origin: [
      "http://localhost:5173",
      "https://box-1-0nll.onrender.com",
      "http://localhost:5000/",
    ],
    credentials: true,
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

app.use(express.json());
app.get("/api/drive-test", async (req, res) => {
  try {
    const auth = new google.auth.GoogleAuth({
      keyFile: process.env.CREDENTIALS,
      scopes: ["https://www.googleapis.com/auth/drive.readonly"],
    });

    const drive = google.drive({ version: "v3", auth });

    const fileId = "16Ph_0-dNggfqYLKC7GXNOK74zKKufALT";

    const meta = await drive.files.get({
      fileId,
      fields: "id,name,mimeType,size",
    });

    res.json(meta.data);
  } catch (err) {
    console.error(err.errors || err.message);
    res.status(500).json({
      error: err.message,
    });
  }
});
app.get("/api/messages", async (req, res) => {
  try {
    const auth = new google.auth.GoogleAuth({
      keyFile: process.env.CREDENTIALS,
      scopes: ["https://www.googleapis.com/auth/drive.readonly"],
    });

    const drive = google.drive({ version: "v3", auth });

    const fileId = "16Ph_0-dNggfqYLKC7GXNOK74zKKufALT";

    const response = await drive.files.get(
      { fileId, alt: "media" },
      { responseType: "stream" }
    );

    let xml = "";

    response.data.on("data", (chunk) => {
      xml += chunk.toString();
    });

    response.data.on("end", () => {
      const parser = new XMLParser({
        ignoreAttributes: false,
        attributeNamePrefix: "",
      });

      const parsed = parser.parse(xml);

      // ensure parsed.smses.sms is always an array
      let smsList = parsed.smses?.sms || [];
      if (!Array.isArray(smsList)) smsList = [smsList];

      // convert dates to numbers
      smsList = smsList.map((sms) => ({
        ...sms,
        date: Number(sms.date),
        date_sent: Number(sms.date_sent),
      }));

      // filter only messages between Nicole and your number
      const allowedNumbers = ["+639669448759", "+639056631503"];
      const filtered = smsList.filter((sms) =>
        allowedNumbers.includes(sms.address)
      );

      // sort by date ascending
      filtered.sort((a, b) => a.date - b.date);

      res.json({
        count: filtered.length,
        data: filtered,
      });
    });

    response.data.on("error", (err) => {
      console.error(err);
      res.status(500).json({ error: "Stream error" });
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Drive API error" });
  }
});

/* -------------------------------
   NEW ROUTE – Google Drive proxy
--------------------------------*/

app.get("/api/sms-from-drive", async (req, res) => {
  try {
    const fileId = "16Ph_0-dNggfqYLKC7GXNOK74zKKufALT";

    const baseUrl = `https://drive.google.com/uc?export=download&id=${fileId}`;

    // 1. First request
    const r1 = await fetch(baseUrl, {
      redirect: "manual",
    });

    let xmlText;

    // If Drive directly returns the file
    const contentType = r1.headers.get("content-type") || "";

    if (contentType.includes("xml")) {
      xmlText = await r1.text();
    } else {
      // 2. Need confirm token
      const html = await r1.text();

      const match = html.match(/confirm=([0-9A-Za-z_-]+)/);

      if (!match) {
        return res.status(500).json({
          error: "Unable to extract Google Drive confirmation token",
        });
      }

      const confirm = match[1];

      const r2 = await fetch(
        `https://drive.google.com/uc?export=download&confirm=${confirm}&id=${fileId}`
      );

      xmlText = await r2.text();
    }

    // small safety check
    if (!xmlText.trim().startsWith("<smses")) {
      return res.status(500).json({
        error: "Google Drive did not return the XML file",
      });
    }

    // 3. Parse XML
    const parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: "",
    });

    const parsed = parser.parse(xmlText);

    const list = parsed.smses?.sms || [];

    const normalized = list.map((m) => ({
      ...m,
      date: Number(m.date),
      date_sent: Number(m.date_sent),
      read: Number(m.read),
      type: Number(m.type),
      locked: Number(m.locked),
      sub_id: Number(m.sub_id),
    }));

    res.json({
      count: normalized.length,
      data: normalized,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load XML from Drive" });
  }
});

connectDB();

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(`Server running on ${PORT}`);
});
