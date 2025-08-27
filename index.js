const express = require("express");
const app = express();
const mongoose = require("mongoose");
const authRoutes = require("./routes/User");
const imageRoutes = require("./routes/Image");
const seoGenRoutes = require("./routes/seo-gen");
const userToken = require("./routes/Useroken");
const userFileCount = require("./routes/UserFileCount");
const adminTokenDedux = require("./routes/AdminTokenDeduction");
const pricing = require("./routes/Pricing");
const walleeRoutes = require("./routes/Wallee"); // <— add this

const cors = require("cors");
require("dotenv").config({});
//all of the middlewares
app.use(cors("*"));
app.use(express.json({ limit: "1gb" })); // or '200mb', etc.

app.use(express.json());

//connect the mongodb

const db = mongoose.connect(process.env.MONGODB);
if (db) {
  console.log("mongodb connected");
} else {
  console.log("sorry mongodb not connected");
}

app.use("/api", authRoutes);
app.use("/api", imageRoutes);
app.use("/api", seoGenRoutes);
app.use("/api/tokens", userToken);
app.use("/api", userFileCount);
app.use("/api", adminTokenDedux);
app.use("/api", pricing);
app.use("/api/payments", walleeRoutes); // <— mount under /api/payments

app.listen(process.env.PORT, () => {
  console.log("server opened at 5000 port");
});
