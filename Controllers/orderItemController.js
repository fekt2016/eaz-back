const OrderItem = require('../Models/OrderItemModel');
const handleFactory = require('../Controllers/handleFactory');

exports.getAllOrderItem = handleFactory.getAll(OrderItem);
exports.getOrderItem = handleFactory.getOne(OrderItem);
exports.createOrderItem = handleFactory.createOne(OrderItem);
exports.updateOrderItem = handleFactory.updateOne(OrderItem);
exports.deleteOrderItem = handleFactory.deleteOne(OrderItem);
