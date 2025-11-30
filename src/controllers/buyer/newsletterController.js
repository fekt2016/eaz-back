const Newsletter = require('../../models/user/newsletterModel'); // make sure you imported it

exports.subscribeToNewsletter = async (req, res, next) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({
        status: 'fail',
        message: 'Email is required',
      });
    }

    // check if already subscribed
    const existing = await Newsletter.findOne({ email });
    if (existing) {
      return res.status(400).json({
        status: 'fail',
        message: 'Email already subscribed',
      });
    }

    const subscribe = await Newsletter.create({ email });

    res.status(201).json({
      status: 'success',
      data: { subscribe },
    });
  } catch (err) {
    res.status(500).json({
      status: 'error',
      message: 'Something went wrong',
    });
  }
};

exports.unsubscribeFromNewsletter = (req, res, next) => {
  res.status(204).json({ data: null, status: 'success' });
};

exports.getAllSubscribers = async (req, res, next) => {
  try {
    const subscribers = await Newsletter.find();
    res.status(200).json({
      status: 'success',
      data: { subscribers },
    });
  } catch (err) {
    res.status(500).json({
      status: 'error',
      message: 'Something went wrong',
    });
  }
};
