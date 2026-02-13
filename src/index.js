import express from "express";
import dotenv from "dotenv";
import cors from "cors";
import { connectDB } from "./config/db.js";
import fetch from "node-fetch";
import { google } from "googleapis";
import { XMLParser } from "fast-xml-parser";
import BackupMeta from "../model/BackupMeta.js";
import { getTodayPrefix } from "../helper/getTodayPrefix.js";

dotenv.config();

const app = express();

const fileId = "11N2sAIHhjHQQ3Tkc2_El7ML61qeSvAQ-";

const allowedOrigins = [
  "http://localhost:5173",
  "https://box-1-0nll.onrender.com",
];

app.use(
  cors({
    origin: function (origin, callback) {
      // allow requests with no origin (like curl, Postman)
      if (!origin) return callback(null, true);
      if (allowedOrigins.includes(origin)) {
        return callback(null, true);
      } else {
        return callback(new Error("Not allowed by CORS"));
      }
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

app.use(express.json());

app.get("/api/messages", async (req, res) => {
  try {
    const auth = new google.auth.GoogleAuth({
      keyFile: process.env.CREDENTIALS,
      scopes: ["https://www.googleapis.com/auth/drive.readonly"],
    });

    const drive = google.drive({ version: "v3", auth });

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

app.get("/api/messages-new", async (req, res) => {
  let sent = false;

  try {
    const auth = new google.auth.GoogleAuth({
      keyFile: process.env.CREDENTIALS,
      scopes: ["https://www.googleapis.com/auth/drive.readonly"],
    });

    const drive = google.drive({ version: "v3", auth });

    // ----------------------------
    // 1. Find today's newest file
    // ----------------------------
    const prefix = getTodayPrefix();

    console.log("Looking for prefix:", prefix);

    const list = await drive.files.list({
      q: `name contains 'sms-' and name contains '.xml' and trashed = false`,

      fields: "files(id, name, createdTime)",
      orderBy: "createdTime desc",
    });

    if (!list.data.files || list.data.files.length === 0) {
      return res.status(404).json({
        error: `No SMS backup found for ${prefix}`,
      });
    }

    const newest = list.data.files[0];

    // ---------------------------------
    // 2. Rotate current / previous file
    // ---------------------------------
    let meta = await BackupMeta.findById("sms-backup");

    if (!meta) {
      meta = new BackupMeta({
        _id: "sms-backup",
        current: {
          fileId: newest.id,
          name: newest.name,
          createdTime: newest.createdTime,
        },
      });

      await meta.save();
    } else {
      if (meta.current?.fileId !== newest.id) {
        meta.previous = meta.current;

        meta.current = {
          fileId: newest.id,
          name: newest.name,
          createdTime: newest.createdTime,
        };

        await meta.save();
      }
    }

    const fileId = meta.current.fileId;

    // ----------------------------
    // 3. Download the file
    // ----------------------------
    const response = await drive.files.get(
      { fileId, alt: "media" },
      { responseType: "stream" }
    );

    let xml = "";

    response.data.on("data", (chunk) => {
      xml += chunk.toString();
    });

    response.data.on("end", () => {
      if (sent) return;
      sent = true;

      try {
        const parser = new XMLParser({
          ignoreAttributes: false,
          attributeNamePrefix: "",
        });

        const parsed = parser.parse(xml);

        let smsList = parsed.smses?.sms || [];
        if (!Array.isArray(smsList)) smsList = [smsList];

        smsList = smsList.map((sms) => ({
          ...sms,
          date: Number(sms.date),
          date_sent: Number(sms.date_sent),
        }));

        const allowedNumbers = ["+639669448759", "+639056631503"];

        const filtered = smsList.filter((sms) =>
          allowedNumbers.includes(sms.address)
        );

        filtered.sort((a, b) => a.date - b.date);

        res.json({
          count: filtered.length,
          data: filtered,
          backup: {
            current: meta.current,
            previous: meta.previous || null,
          },
        });
      } catch (e) {
        console.error(e);
        res.status(500).json({ error: "Parse error" });
      }
    });

    response.data.on("error", (err) => {
      if (sent) return;
      sent = true;

      console.error(err);
      res.status(500).json({ error: "Stream error" });
    });
  } catch (err) {
    console.error(err);

    if (!res.headersSent) {
      res.status(500).json({ error: "Drive API error" });
    }
  }
});

connectDB();

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(`Server running on ${PORT}`);
});
