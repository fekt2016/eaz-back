const mongoose = require('mongoose');

const sequenceSchema = new mongoose.Schema({
  _id: {
    type: String,
    required: true,
  },
  seq: {
    type: Number,
    default: 0,
  },
});

const Sequence = mongoose.model('Sequence', sequenceSchema);

module.exports = Sequence;
