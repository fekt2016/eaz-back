const mongoose = require('mongoose');

const reportSchema = new mongoose.Schema({});

const Report = new mongoose.model('Report', reportSchema);

module.exports = Report;
