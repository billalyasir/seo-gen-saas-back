const UserFileCount = require("../models/UserFileCount");

const updateUser = async (req, res) => {
  try {
    const count = await UserFileCount.findOne({ user: req.user.id });
    count.count = req.body.count;
    await count.save();
    res.status(200).json(count);
  } catch (error) {
    console.log(error);
  }
};

const getFileCount = async (req, res) => {
  try {
    const count = await UserFileCount.findOne({ user: req.user.id });
    return res.status(200).json(count);
  } catch (error) {
    return res.status(500).json("something went wrong");
  }
};

module.exports = { updateUser, getFileCount };
