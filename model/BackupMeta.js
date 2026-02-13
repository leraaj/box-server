import mongoose from "mongoose";

const BackupMetaSchema = new mongoose.Schema({
  _id: String,
  current: {
    fileId: String,
    name: String,
    createdTime: String,
  },
  previous: {
    fileId: String,
    name: String,
    createdTime: String,
  },
});

export default mongoose.model("BackupMeta", BackupMetaSchema);
