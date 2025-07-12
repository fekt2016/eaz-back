const mongoose = require('mongoose');

const dotenv = require('dotenv');
dotenv.config({ path: './config.env' });

const app = require('./app');

const mongodb = process.env.MONGO_URL.replace(
  '<PASSWORD>',
  process.env.DATABASE_PASSWORD,
);

//database connection
mongoose
  .connect(mongodb)
  .then(() => console.log('Connected to MongoDB'))
  .catch((error) => {
    console.log('Error connecting to MongoDB');
  });

//server connection
const port = process.env.PORT || 4000;
const server = app.listen(port, () => {
  console.log(`app connected at port ${port} successfully`);
});

process.on('unhandledRejection', (err) => {
  console.log('UNHANDLER REJECTION! 🔥 Shuttung down');
  console.log(err.name, err.message);
  server.close(() => {
    process.exit(1);
  });
});

process.on('uncaughtException', (err) => {
  console.log('UNHANDLER Exception! 🔥 Shuttung down');
  console.log(err.name, err.message);
  server.close(() => {
    process.exit(1);
  });
});
