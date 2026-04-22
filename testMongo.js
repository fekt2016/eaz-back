const mongoose = require('mongoose');
const url = 'mongodb+srv://fekt2017_db_user:America1234567890@cluster0.6vcorfz.mongodb.net/';

mongoose.connect(url)
  .then(async () => {
    const db = mongoose.connection.db;
    const conversations = await db.collection('chatconversations').find({
      participantRole: 'seller'
    }).sort({ updatedAt: -1 }).limit(1).toArray();
    console.log(JSON.stringify(conversations, null, 2));
    process.exit(0);
  });
