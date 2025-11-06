const OrderItem = require('../../models/order/OrderItemModel');
const handleFactory = require('../shared/handleFactory');

exports.getAllOrderItem = handleFactory.getAll(OrderItem);
exports.getOrderItem = handleFactory.getOne(OrderItem);
exports.createOrderItem = handleFactory.createOne(OrderItem);
exports.updateOrderItem = handleFactory.updateOne(OrderItem);
exports.deleteOrderItem = handleFactory.deleteOne(OrderItem);
