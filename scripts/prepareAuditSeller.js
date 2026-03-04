const mongoose = require('mongoose');
const dotenv = require('dotenv');
const path = require('path');

// Load environment variables
dotenv.config({ path: path.join(__dirname, '../.env') });

const Seller = require('../src/models/user/sellerModel');

const prepareAuditSeller = async () => {
    try {
        const mongoUrl = process.env.MONGO_URL.replace('<PASSWORD>', process.env.DATABASE_PASSWORD);
        await mongoose.connect(mongoUrl);
        console.log('Connected to MongoDB');

        const email = 'easyworldbtc@gmail.com';
        const passwordHash = '$2a$12$.CWjvcYZ2sUSvSffT5hIPOTeXY72S4sQcEA/dqybaqqKiNe.nBXoW'; // America@123

        let seller = await Seller.findOne({ email });

        if (!seller) {
            console.log(`Seller with email ${email} not found. Creating a new one...`);
            seller = new Seller({
                name: 'Audit Seller',
                shopName: 'Audit Shop',
                email,
                phone: '0240000000',
                password: 'America@123', // Will be hashed by pre-save hook
                passwordConfirm: 'America@123',
                status: 'active'
            });
        }

        console.log('Updating seller status to fully verified...');

        seller.status = 'active';
        seller.onboardingStage = 'verified';
        seller.verificationStatus = 'verified';
        seller.verification = {
            emailVerified: true,
            businessVerified: true
        };

        // Set mandatory ID proof as verified
        seller.verificationDocuments = {
            idProof: {
                url: 'https://example.com/id.png',
                status: 'verified',
                verifiedBy: new mongoose.Types.ObjectId(),
                verifiedAt: new Date()
            },
            businessCert: {
                url: 'https://example.com/cert.png',
                status: 'verified',
                verifiedBy: new mongoose.Types.ObjectId(),
                verifiedAt: new Date()
            }
        };

        // Set payment methods to verified
        seller.paymentMethods = {
            mobileMoney: {
                accountName: 'Audit Seller',
                phone: '0240000000',
                network: 'MTN',
                payoutStatus: 'verified',
                payoutVerifiedAt: new Date(),
                payoutVerifiedBy: new mongoose.Types.ObjectId()
            }
        };

        seller.requiredSetup = {
            hasAddedBusinessInfo: true,
            hasAddedBankDetails: true,
            hasAddedFirstProduct: true,
            hasBusinessDocumentsVerified: true,
            hasPaymentMethodVerified: true
        };

        seller.password = passwordHash;
        seller.passwordConfirm = undefined;

        await seller.save({ validateBeforeSave: false });
        console.log(`Seller ${email} is now fully verified and password is set to 'America@123'.`);

        process.exit(0);
    } catch (error) {
        console.error('Error preparing audit seller:', error);
        process.exit(1);
    }
};

prepareAuditSeller();
