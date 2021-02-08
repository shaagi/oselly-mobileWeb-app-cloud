// sendgrid doesnt need different key
const devEnv = {
    stripeKey: "sk_test_REDACTED",
    planyoCourtRentalResourceId: 111111,
    planyoApiKey: 'REDACTED', // this is api key for shaagi@hotmail planyo account
    planyoFullGymRentalResourceId: 11111,
    isTest: true,
    postMarkServerApiToken: "REDACTED",
};

const prodEnv = {
    stripeKey: "sk_live_REDACTED",
    planyoCourtRentalResourceId: 11111,
    planyoApiKey: 'REDACTED',
    planyoFullGymRentalResourceId: 11111,
    isTest: false,
    postMarkServerApiToken: "REDACTED",
};

const productionProjectId = 'REDACTED';

module.exports.environment = process.env.GCLOUD_PROJECT === productionProjectId ? prodEnv : devEnv;
