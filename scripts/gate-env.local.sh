#!/usr/bin/env bash

# Copy to scripts/gate-env.local.sh and fill real credentials.
# Do NOT commit the local file.

export API_BASE='http://127.0.0.1:4000'
export WAIT_FOR_API_SECONDS='45'

# Buyer auth gate
export BUYER_LOGIN_BODY_JSON='{"email":"benzflex00@gmail.com","password":"America@123"}'
export BUYER_LOGIN_PATH='/api/v1/users/login'
export BUYER_MUTATION_PATH='/api/v1/users/updateMe'
export BUYER_MUTATION_METHOD='PATCH'
export BUYER_MUTATION_BODY_JSON='{"fullName":"Buyer Gate Probe"}'

# Seller auth gate
export SELLER_LOGIN_BODY_JSON='{"email":"easyworldbtc@gmail.com","password":"America@123"}'
export SELLER_LOGIN_PATH='/api/v1/seller/login'
export SELLER_MUTATION_PATH='/api/v1/seller/profile/update'
export SELLER_MUTATION_METHOD='PATCH'
export SELLER_MUTATION_BODY_JSON='{"shopName":"Seller Gate Probe"}'

# Admin auth gate
export ADMIN_LOGIN_BODY_JSON='{"email":"easyworldbtc@gmail.com","password":"America@123"}'
export ADMIN_LOGIN_PATH='/api/v1/admin/login'
export ADMIN_MUTATION_PATH='/api/v1/admin/profile/update'
export ADMIN_MUTATION_METHOD='PATCH'
export ADMIN_MUTATION_BODY_JSON='{"fullName":"Admin Gate Probe"}'
