import mongoose from "mongoose";
import dotenv from "dotenv";

dotenv.config({ quiet: true });

export async function connectDB() {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log("MongoDB connected");
  } catch (err) {
    console.error("Mongo error:", err.message);
    process.exit(1);
  }
}
