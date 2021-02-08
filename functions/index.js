const environment = require('./environment').environment;

const functions = require('firebase-functions');
const admin = require('firebase-admin');

const moment = require('moment');
require('moment-timezone');


// Set your secret key: remember to change this to your live secret key in production
// See your keys here: https://dashboard.stripe.com/account/apikeys
const stripe = require("stripe")(environment.stripeKey);

const postmark = require("postmark");
const client = new postmark.ServerClient(environment.postMarkServerApiToken);

const axios = require('axios');
const qs = require('qs');

admin.initializeApp();
admin.firestore().settings({timestampsInSnapshots: true});


exports.askToConfirmIfNeeded = functions.pubsub.schedule('every 15 minutes').onRun((context) => {
    console.log('finalize if needed will be run every 15 minutes!');
    return admin.firestore().collection('bookings').where('oselly', '==', true).get()
        .then(snapshot => {
            const tasks =[];
            snapshot.forEach(doc => {
                console.log('id of doc is: ' + doc.id);
                console.log(doc.data());

                const currDate= new Date();
                if (doc.data().sendConfirmMessageByDate !== undefined) {
                    if (currDate > doc.data().sendConfirmMessageByDate.toDate()) {
                        console.log('update something to true so we can message asking to confirm ' + doc.id);
                        tasks.push(admin.firestore().collection('bookings').doc(doc.id)
                            .collection('confirm-col').doc('confirmMessage').update({
                                messageSent: true
                            }));
                    } else {
                        console.log(doc.id + ' doc doesnt need confirmation message to be sent yet')
                    }
                }
            });
            return Promise.all(tasks);
        }).catch(err => {
            console.error(err);
        });
    // return admin.firestore().collection('bookings').where('oselly', '==', true).get()
    //     .then(snapshot => {
    //         const tasks = [];
    //         const currDate = new Date();
    //
    //         snapshot.forEach(doc => {
    //             if (doc.data().finalizeByDate !== undefined) {
    //                 if (currDate > doc.data().finalizeByDate.toDate()) {
    //                     tasks.push(admin.firestore().collection('bookings').doc(doc.id).collection('finalize-col').doc('finalize-doc').update({finalized: true})
    //                         .then(data => {
    //                             console.log('finalized of ' + doc.id + ' has been updated to true ' + data);
    //                             return true;
    //                         }).catch(err => {
    //                             console.log('error in finalizing: ' + err);
    //                         }));
    //                 } else {
    //                     console.log('current date is not greater than finalizeBy date for game ' + doc.id);
    //                 }
    //             } else {
    //                 console.log('finalizeByDate is undefined for game ' + doc.id);
    //             }
    //         });
    //         return Promise.all(tasks);
    // }).catch(error => {
    //     console.log(error);
    // });
});

exports.uponConfirmationMessageTrigger = functions.firestore
    .document('bookings/{bookingId}/confirm-col/confirmMessage').onUpdate((change, context) => {
        return admin.firestore().collection('users')
            .where('bookings', 'array-contains', context.params.bookingId).get()
            .then(querySnapshot => {
                console.log('triggered');
                console.log(querySnapshot.docs);
                console.log(querySnapshot.docs[0]);
                // return true;
                return admin.firestore().collection('users').doc(querySnapshot.docs[0].id).update({
                    notifications: admin.firestore.FieldValue.arrayUnion({
                        messageType: 'askToConfirm',
                        time: new Date(),
                        booking: context.params.bookingId
                    })
                });
            })
            .catch(err => {
                console.error(err);
            });
    });

exports.uponFinalization = functions.firestore
    .document('bookings/{gameId}/finalize-col/finalize-doc')
    .onUpdate((change, context) => {
        console.log('triggered as a result of updating finalization status');
        const newValue = change.after.data();
        console.log('finalization status of ' + context.params.gameId + ' is ' + newValue.finalized);

        if (newValue.finalized === true) {
            let noOfPpl = 0;
            let playerEmails = [];
            let playerUnsubs = [];
            let playerUserIds = [];
            let playerNames = [];
            let emails = [];
            let playerCustIds = [];
            let priceOfRental = 0;
            let centsToCharge = 0;
            let dollarsCharged = 0;
            let duration;
            let playerFirstNames = [];
            let playerCards = [];
            let playerLast4s = [];
            let dateOfStartTime;

            return Promise.all([
                admin.firestore().collection('bookings').doc(context.params.gameId).collection('host').get(),
                admin.firestore().collection('bookings').doc(context.params.gameId).collection('semiHosts').get(),
                admin.firestore().collection('bookings').doc(context.params.gameId).collection('members').get(),
                admin.firestore().collection('bookings').doc(context.params.gameId).get(),
                admin.firestore().collection('bookings').doc(context.params.gameId).collection('spotBuyers').get(),
            ])
                .then(playersCols => {
                    noOfPpl = playersCols[0].size + playersCols[1].size + playersCols[2].size;
                    playersCols[0].forEach(host => {
                        playerEmails.push(host.data().email);
                        playerUserIds.push(host.id);
                        playerNames.push(host.data().name);
                        const nameFragments = host.data().name.split(' ');
                        playerFirstNames.push(nameFragments[0]);
                        if (host.data().unsubs !== undefined) {
                            playerUnsubs.push(host.data().unsubs);
                        } else {
                            playerUnsubs.push([]);
                        }
                    });
                    playersCols[1].forEach(semiHost => {
                        playerEmails.push(semiHost.data().email);
                        playerUserIds.push(semiHost.id);
                        playerNames.push(semiHost.data().name);
                        const nameFragments = semiHost.data().name.split(' ');
                        playerFirstNames.push(nameFragments[0]);
                        if (semiHost.data().unsubs !== undefined) {
                            playerUnsubs.push(semiHost.data().unsubs);
                        } else {
                            playerUnsubs.push([]);
                        }
                    });
                    playersCols[2].forEach(member => {
                        playerEmails.push(member.data().email);
                        playerUserIds.push(member.id);
                        playerNames.push(member.data().name);
                        const nameFragments = member.data().name.split(' ');
                        playerFirstNames.push(nameFragments[0]);
                        if (member.data().unsubs !== undefined) {
                            playerUnsubs.push(member.data().unsubs);
                        } else {
                            playerUnsubs.push([]);
                        }
                    });
                    dateOfStartTime = moment(playersCols[3].data().time.startTime.toDate()).tz('America/Toronto').format('MMMM Do YYYY');
                    playersCols[4].forEach(spotBuyer => {
                        playerEmails.push(spotBuyer.data().email);
                        playerUserIds.push(spotBuyer.id);
                        playerNames.push(spotBuyer.data().name);
                        const nameFragments = spotBuyer.data().name.split(' ');
                        playerFirstNames.push(nameFragments[0]);
                        if (spotBuyer.data().unsubs !== undefined) {
                            playerUnsubs.push(spotBuyer.data().unsubs);
                        } else {
                            playerUnsubs.push([]);
                        }
                    });

                    let promisesToGetCustIds = [];
                    for (var i = 0; i < playerUserIds.length; i++) {
                        promisesToGetCustIds.push(admin.firestore().collection('users').doc(playerUserIds[i]).get());
                    }
                    console.log('promises: ' + promisesToGetCustIds);
                    return Promise.all(promisesToGetCustIds)
                }).then(col => {
                    for (var i = 0; i < col.length; i++) {
                        playerCustIds.push(col[i].data().customerId);
                    }
                    console.log('player custIds: ' + playerCustIds);
                    return admin.firestore().collection('bookings').doc(context.params.gameId).get();
                }).then(data => {
                    duration = moment.unix(data.data().time.endTime.seconds).diff(moment.unix(data.data().time.startTime.seconds), 'minutes');
                    return admin.firestore().collection('courts').doc(data.data().court.id).get();
                }).then(court => {
                    return admin.firestore().collection('gyms').doc(court.data().gym.id).get();
                }).then(gymData => {
                    if (duration === 60) {
                        priceOfRental = gymData.data().cost60Min;
                        duration = 1;
                    } else if (duration === 90) {
                        priceOfRental = gymData.data().cost90Min;
                        duration = 1.5;
                    } else if (duration === 120) {
                        priceOfRental = gymData.data().cost120Min;
                        duration = 2;
                    }
                    const gymStripeAccountId = gymData.data().accountId;
                    centsToCharge = Math.floor((priceOfRental/playerCustIds.length)*100);
                    dollarsCharged = (priceOfRental/playerCustIds.length).toFixed(2);

                    console.log('cents to charge each user: ' + centsToCharge);

                    let promisesToChargeUsers = [];
                    for (var i = 0; i < playerCustIds.length; i++) {
                        promisesToChargeUsers.push(
                            stripe.charges.create({
                                amount: centsToCharge,
                                currency: 'cad',
                                customer: playerCustIds[i],
                                transfer_data: {
                                    destination: gymStripeAccountId,
                                },
                            }), {
                                idempotency_key: "O57i27ZVRQtn5uf6"
                            });
                    }
                    console.log(promisesToChargeUsers);
                    return Promise.all(promisesToChargeUsers);
                }).then(data => {
                    console.log('check Stripe: ' + data);
                    const chargesArray = data.filter(el => el.object !== undefined);
                    for (var j = 0; j < playerNames.length; j++) {
                        playerCards.push(chargesArray[j].payment_method_details.card.brand);
                        playerLast4s.push(chargesArray[j].payment_method_details.card.last4);
                    }
                    let fulfilledGamesLink = 'https://oselly.com/goneThrough'; // link will be dynamic

                    for (var i = 0; i < playerNames.length; i++) {
                        if (playerUnsubs[i].includes('receipt') === false) {
                            const notifLink = 'https://oselly.com/profile?random=' + playerUserIds[i];
                            if (environment.isTest === true) {
                                emails.push({
                                    "From": "Oselly <info@osellymail.com>",
                                    "To": "info@osellymail.com",
                                    "Tag": "Receipt",
                                    "TemplateAlias": "receipt",
                                    "TemplateModel": {
                                        "user_first_name": playerFirstNames[i],
                                        "payment_card_brand": playerCards[i],
                                        "payment_card_last_four": playerLast4s[i],
                                        "receipt_id": Math.floor((Math.random() * 10000)),
                                        "date": dateOfStartTime,
                                        "duration": duration,
                                        "dollars_charged": dollarsCharged,
                                        "notifications_url": notifLink,
                                        "fulfilledGames_url": fulfilledGamesLink,
                                        "product_name": "Oselly Basketball",
                                        "company_name": "Oselly Sports, LLC",
                                        "company_address": "11965 Hurontario St. Brampton, ON L6Z 4P0"
                                    },
                                });
                            } else {
                                emails.push({
                                    "From": "Oselly <info@osellymail.com>",
                                    "To": playerEmails[i],
                                    "Tag": "Receipt",
                                    "TemplateAlias": "receipt",
                                    "TemplateModel": {
                                        "user_first_name": playerFirstNames[i],
                                        "payment_card_brand": playerCards[i],
                                        "payment_card_last_four": playerLast4s[i],
                                        "receipt_id": Math.floor((Math.random() * 10000)),
                                        "date": dateOfStartTime,
                                        "duration": duration,
                                        "dollars_charged": dollarsCharged,
                                        "notifications_url": notifLink,
                                        "fulfilledGames_url": fulfilledGamesLink,
                                        "product_name": "Oselly Basketball",
                                        "company_name": "Oselly Sports, LLC",
                                        "company_address": "11965 Hurontario St. Brampton, ON L6Z 4P0"
                                    },
                                });
                            }
                        } else {
                            console.log(playerFirstNames[i] + ' is unsubbed from this email');
                        }
                    }
                    return client.sendEmailBatchWithTemplates(emails);
                }).then(data => {
                    console.log('youve been charged emails sent out looks like');
                    return true;
                }).catch(err => {
                    console.log(err);
                });
        }
        return true;
    });

exports.updateEmailPreferences = functions.https.onCall((data, context) => {
    console.log(data);
    if (data.wantsUnsub === true) {
        return admin.firestore().collection('users').doc(data.userUid).update({unsubs: admin.firestore.FieldValue.arrayUnion(data.emailType)});
    } else if (data.wantsUnsub === false) {
        return admin.firestore().collection('users').doc(data.userUid).update({unsubs: admin.firestore.FieldValue.arrayRemove(data.emailType)});
    }
});

exports.uponBookingExpiration = functions.firestore
    .document('bookings/{gameId}/booking-expired-col/booking-expired-doc').onUpdate((change, context) => {
        const newValue = change.after.data();
        console.log('bookingExpired status of ' + context.params.gameId + ' is ' + newValue.bookingExpired);

        if (newValue.bookingExpired === true) {
            let noOfPpl = 0;
            let playerEmails = [];
            let playerUnsubs = [];
            let playerUserIds = [];
            let playerNames = [];
            let playerFirstNames = [];
            let emails = [];
            let priceOfRental = 0;
            let dollarsCharged = 0;
            let duration = 0;
            let hostName = '';
            let pplIn = [];

            return Promise.all([
                admin.firestore().collection('bookings').doc(context.params.gameId).collection('host').get(),
                admin.firestore().collection('bookings').doc(context.params.gameId).collection('semiHosts').get(),
                admin.firestore().collection('bookings').doc(context.params.gameId).collection('members').get(),
                admin.firestore().collection('bookings').doc(context.params.gameId).get(),
            ]).then(playersCols => {
                noOfPpl = playersCols[0].size + playersCols[1].size + playersCols[2].size;

                playersCols[0].forEach(host => {
                    playerEmails.push(host.data().email);
                    playerUserIds.push(host.id);
                    playerNames.push(host.data().name);
                    hostName = host.data().name;
                    const nameFragments = host.data().name.split(' ');
                    playerFirstNames.push(nameFragments[0]);
                    pplIn.push({name: host.data().name, inviter: 'himself'});
                    if (host.data().unsubs !== undefined) {
                        playerUnsubs.push(host.data().unsubs);
                    } else {
                        playerUnsubs.push([]);
                    }
                });
                playersCols[1].forEach(semiHost => {
                    playerEmails.push(semiHost.data().email);
                    playerUserIds.push(semiHost.id);
                    playerNames.push(semiHost.data().name);
                    const nameFragments = semiHost.data().name.split(' ');
                    playerFirstNames.push(nameFragments[0]);
                    pplIn.push({name: semiHost.data().name, inviter: hostName});
                    if (semiHost.data().unsubs !== undefined) {
                        playerUnsubs.push(semiHost.data().unsubs);
                    } else {
                        playerUnsubs.push([]);
                    }
                });
                playersCols[2].forEach(member => {
                    playerEmails.push(member.data().email);
                    playerUserIds.push(member.id);
                    playerNames.push(member.data().name);
                    const nameFragments = member.data().name.split(' ');
                    playerFirstNames.push(nameFragments[0]);
                    pplIn.push({name: member.data().name, inviter: member.data().invitedBy});
                    if (member.data().unsubs !== undefined) {
                        playerUnsubs.push(member.data().unsubs);
                    } else {
                        playerUnsubs.push([]);
                    }
                });

                const startTimeEmail = moment(playersCols[3].data().time.startTime.toDate()).tz('America/Toronto').format('dddd, MMM Do, h:mmA');
                const endTimeEmail = moment(playersCols[3].data().time.endTime.toDate()).tz('America/Toronto').format('h:mmA');

                if (playersCols[3].data().enoughPplInterested === true) {
                    return admin.firestore().collection('bookings').doc(context.params.gameId).collection('finalize-col').doc('finalize-doc').set({'finalized': false
                    }).then(data => {
                        let startTimeMoment = moment(playersCols[3].data().time.startTime.toDate());
                        let finalizeByDateMoment = moment(startTimeMoment).subtract(2, 'hours');
                        let finalizeByDate = finalizeByDateMoment.toDate();
                        return admin.firestore().collection('bookings').doc(context.params.gameId).update({finalizeByDate: finalizeByDate});
                    }).then(data=> {
                        duration = moment.unix(playersCols[3].data().time.endTime.seconds).diff(moment.unix(playersCols[3].data().time.startTime.seconds), 'minutes');
                        return admin.firestore().collection('courts').doc(playersCols[3].data().court.id).get();
                    }).then(court => {
                        return admin.firestore().collection('gyms').doc(court.data().gym.id).get();
                    }).then(gymData => {
                        if (duration === 60) {
                            priceOfRental = gymData.data().cost60Min;
                        } else if (duration === 90) {
                            priceOfRental = gymData.data().cost90Min;
                        } else if (duration === 120) {
                            priceOfRental = gymData.data().cost120Min;
                        }
                        dollarsCharged = (priceOfRental / playerUserIds.length).toFixed(2);
                        return true;
                    }).then(info => {
                        let promisesToAddFulfilledGame = [];
                        for (var i = 0; i < playerUserIds.length; i++) {
                            promisesToAddFulfilledGame.push(admin.firestore().collection('users').doc(playerUserIds[i]).update(
                                {fulfilledGames: admin.firestore.FieldValue.arrayUnion(context.params.gameId)}));
                        }
                        return Promise.all(promisesToAddFulfilledGame);
                    }).then(data => {
                        let promisesToRemoveGameIdFromPendingGames = [];
                        for (var i = 0; i < playerUserIds.length; i++) {
                            promisesToRemoveGameIdFromPendingGames.push(admin.firestore().collection('users').doc(playerUserIds[i]).update(
                                {pendingGames: admin.firestore.FieldValue.arrayRemove(context.params.gameId)}));
                        }
                        return Promise.all(promisesToRemoveGameIdFromPendingGames);
                    }).then(data => {
                        let fulfilledGamesLink = 'https://oselly.com/goneThrough'; // link will be dynamic
                        for (var i = 0; i < playerNames.length; i++) {
                            if (playerUnsubs[i].includes('gameHappening') === false) {
                                const notifLink = 'https://oselly.com/profile?random=' + playerUserIds[i];
                                if (environment.isTest === true) {
                                    emails.push({
                                        "From": "Oselly <info@osellymail.com>",
                                        "To": "info@osellymail.com",
                                        "Tag": "GameHappening",
                                        "TemplateAlias": "comment-notification-1",
                                        "TemplateModel": {
                                            "user_first_name": playerFirstNames[i],
                                            "slotStartTime": startTimeEmail,
                                            "slotEndTime": endTimeEmail,
                                            "pplWhoWereIn": pplIn,
                                            "totalPpl": playerUserIds.length,
                                            "dollarsCharged": dollarsCharged,
                                            "notifications_url": notifLink,
                                            "fulfilledGames_url": fulfilledGamesLink,
                                            "company_name": "Oselly Sports, LLC",
                                            "company_address": "11965 Hurontario St. Brampton, ON L6Z 4P0"
                                        },
                                    });
                                } else {
                                    emails.push({
                                        "From": "Oselly <info@osellymail.com>",
                                        "To": playerEmails[i],
                                        "Tag": "GameHappening",
                                        "TemplateAlias": "comment-notification-1",
                                        "TemplateModel": {
                                            "user_first_name": playerFirstNames[i],
                                            "slotStartTime": startTimeEmail,
                                            "slotEndTime": endTimeEmail,
                                            "pplWhoWereIn": pplIn,
                                            "totalPpl": playerUserIds.length,
                                            "dollarsCharged": dollarsCharged,
                                            "notifications_url": notifLink,
                                            "fulfilledGames_url": fulfilledGamesLink,
                                            "company_name": "Oselly Sports, LLC",
                                            "company_address": "11965 Hurontario St. Brampton, ON L6Z 4P0"
                                        },
                                    });
                                }
                            } else {
                                console.log(playerFirstNames[i] + ' is unsubbed from this email');
                            }
                        }
                        return client.sendEmailBatchWithTemplates(emails);
                    }).then(data => {
                        console.log('Game happening emails sent out looks like');
                        return true;
                    }).catch(err => {
                        console.log(err);
                    });
                } else {
                    let hosts = [];
                    let semiHosts = [];
                    let members = [];

                    playersCols[0].forEach(host => {
                        const hostObj = {
                            uid: host.id,
                            name: host.data().name,
                            email: host.data().email
                        };
                        hosts.push(hostObj);
                    });
                    playersCols[1].forEach(semiHost => {
                        const semiHostObj = {
                            uid: semiHost.id,
                            name: semiHost.data().name,
                            email: semiHost.data().email
                        };
                        semiHosts.push(semiHostObj);
                    });
                    playersCols[2].forEach(member => {
                        const memberObj = {
                            uid: member.id,
                            name: member.data().name,
                            email: member.data().email,
                        };
                        members.push(memberObj);
                    });

                    console.log('go into each users collection and take out this gameId from their pendingGames array');
                    removeGameIdFromPendingGamesArray(context.params.gameId, playerUserIds);
                    deleteReservationFromPlanyo(playersCols[3].data().planyoReservationId);
                    let slotsLink = 'https://oselly.com/slots';

                    return admin.firestore().collection('bookingsFailed').doc(playersCols[3].id).set({
                        court: playersCols[3].data().court,
                        date: playersCols[3].data().date,
                        max: playersCols[3].data().max,
                        min: playersCols[3].data().min,
                        maxPplReached: playersCols[3].data().maxPplReached,
                        enoughPplInterested: playersCols[3].data().enoughPplInterested,
                        time: {startTime: playersCols[3].data().time.startTime, endTime: playersCols[3].data().time.endTime},
                    }).then(data => {
                        console.log('bookingsFailed doc created looks like');
                        return admin.firestore().collection('bookingsFailed').doc(playersCols[3].id).collection('host').doc(hosts[0].uid).set({
                            email: hosts[0].email,
                            name: hosts[0].name,
                        })
                    }).then(data => {
                        let promisesToAddSemiHosts = [];
                        for (var i = 0; i < semiHosts.length; i++) {
                            promisesToAddSemiHosts.push(
                                admin.firestore().collection('bookingsFailed').doc(playersCols[3].id).collection('semiHosts').doc(semiHosts[i].uid).set({
                                    email: semiHosts[i].email,
                                    name: semiHosts[i].name,
                                })
                            );
                        }
                        return Promise.all(promisesToAddSemiHosts);
                    }).then(data => {
                        let promisesToAddMembers = [];
                        for (var i = 0; i < members.length; i++) {
                            promisesToAddMembers.push(
                                admin.firestore().collection('bookingsFailed').doc(playersCols[3].id).collection('members').doc(members[i].uid).set({
                                    email: members[i].email,
                                    name: members[i].name,
                                })
                            );
                        }
                        return Promise.all(promisesToAddMembers);
                    }).then(data => {
                        return admin.firestore().collection('bookings').doc(playersCols[3].id).collection('booking-expired-col').doc('booking-expired-doc').delete();
                    }).then(data => {
                        return admin.firestore().collection('bookings').doc(playersCols[3].id).collection('host').doc(hosts[0].uid).delete();
                    }).then(data => {
                        let promisesToDeleteSemiHosts = [];
                        for (var i = 0; i < semiHosts.length; i++) {
                            promisesToDeleteSemiHosts.push(
                                admin.firestore().collection('bookings').doc(playersCols[3].id).collection('semiHosts').doc(semiHosts[i].uid).delete()
                            );
                        }
                        return Promise.all(promisesToDeleteSemiHosts);
                    }).then(data => {
                        let promisesToDeleteMembers = [];
                        for (var i = 0; i < members.length; i++) {
                            promisesToDeleteMembers.push(
                                admin.firestore().collection('bookings').doc(playersCols[3].id).collection('members').doc(members[i].uid).delete()
                            );
                        }
                        return Promise.all(promisesToDeleteMembers);
                    }).then(data => {
                        return admin.firestore().collection('bookings').doc(playersCols[3].id).delete();
                    }).then(data => {
                        for (var i = 0; i < playerNames.length; i++) {
                            if (playerUnsubs[i].includes('gameNotHappening') === false) {
                                const notifLink = 'https://oselly.com/profile?random=' + playerUserIds[i];
                                if (environment.isTest === true) {
                                    emails.push({
                                        "From": "Oselly <info@osellymail.com>",
                                        "To": "info@osellymail.com",
                                        "Tag": "GameNotHappening",
                                        "TemplateAlias": "comment-notification",
                                        "TemplateModel": {
                                            "user_first_name": playerFirstNames[i],
                                            "slotStartTime": startTimeEmail,
                                            "pplWhoWereIn": pplIn,
                                            "min": playersCols[3].data().min,
                                            "host_name": hostName,
                                            "notifications_url": notifLink,
                                            "company_name": "Oselly Sports, LLC",
                                            "company_address": "11965 Hurontario St. Brampton, ON L6Z 4P0"
                                        },
                                    });
                                } else {
                                    emails.push({
                                        "From": "Oselly <info@osellymail.com>",
                                        "To": playerEmails[i],
                                        "Tag": "GameNotHappening",
                                        "TemplateAlias": "comment-notification",
                                        "TemplateModel": {
                                            "user_first_name": playerFirstNames[i],
                                            "slotStartTime": startTimeEmail,
                                            "pplWhoWereIn": pplIn,
                                            "min": playersCols[3].data().min,
                                            "host_name": hostName,
                                            "notifications_url": notifLink,
                                            "company_name": "Oselly Sports, LLC",
                                            "company_address": "11965 Hurontario St. Brampton, ON L6Z 4P0"
                                        },
                                    });
                                }
                            } else {
                                console.log(playerFirstNames[i] + ' is unsubbed from this email');
                            }
                        }
                        return client.sendEmailBatchWithTemplates(emails);
                    }).then(data => {
                        console.log('emails were sent out looks like ' + data);
                        return true;
                    }).catch(err => {
                        console.log('failure to create bookingsFailed doc with host col');
                        console.log(err);
                    })
                }
            }).catch(err => {console.log(err)});
        }
        console.log('bookingExpired did not equal true');
        return true;
    });

function removeGameIdFromPendingGamesArray(gameId, playerUserIds) {
    for (let index in playerUserIds) {
        admin.firestore().collection('users').doc(playerUserIds[index]).update({
            pendingGames: admin.firestore.FieldValue.arrayRemove(gameId)
        }).then(data => {
            console.log('took out gameId' + data);
            return true;
        }).catch(error => {
            console.log(error);
        });
    }
    return true;
}

function deleteReservationFromPlanyo(planyoReservationId) {
    return axios.post('https://www.planyo.com/rest/?method=delete_reservation&api_key=' + environment.planyoApiKey, qs.stringify({
        reservation_id: planyoReservationId,
    }), {
        headers: {
            'cache-control': 'no-cache',
            Connection: 'keep-alive',
            'accept-encoding': 'gzip, deflate',
            'Cache-Control': 'no-cache',
            Accept: '*/*',
            'Content-Type': 'application/x-www-form-urlencoded'
        }
    }).then(response => {
        console.log('looks like it deleted it off planyo');
        return true;
    }).catch(err => {
        console.error(err);
        return true;
    }); // what is npm, what is node modules, what is package.json, what is package lock json
}

exports.planyoWebhookReservationConfirmed = functions.https.onRequest((request, response) => {
    console.log(request.body);

    let offset;
    if (moment().tz('America/Toronto').isDST() === true) {
        offset = 4;
    } else {
        offset = 5;
    }
    console.log(offset);
    const startTimeSeconds = moment.unix(request.body.start).add(offset, 'hours').toDate();
    const endTimeSeconds = moment.unix(request.body.end).add(offset, 'hours').toDate();
    const courtName = request.body.unit_names;
    console.log(startTimeSeconds);
    console.log(endTimeSeconds);
    console.log(courtName);

    if (request.body.first_name === 'Oselly') {
        console.log('Oselly booking so dont double add');
        return response.send('looks good');
    } else if (request.body.resource === environment.planyoFullGymRentalResourceId.toString()) { // full gym booked
        return admin.firestore().collection('courts').get()
            .then(querySnapshot => {
                let courtRefs = [];
                querySnapshot.forEach(courtQueryDocSnapShot => { // this only works if benchmark is only gym
                    courtRefs.push(courtQueryDocSnapShot.ref);
                });
                return courtRefs;
            }).then(courtRefs => {
                let promisesToAddBookings = [];
                for (var i = 0; i < courtRefs.length; i++) {
                    promisesToAddBookings.push(admin.firestore().collection('bookings').add({
                        court: courtRefs[i],
                        oselly: false,
                        planyoReservationId: request.body.reservation,
                        time: {startTime: startTimeSeconds, endTime: endTimeSeconds}
                    }));
                }
                return Promise.all(promisesToAddBookings);
            }).then(data => {
                console.log('full gym rental booking added looks like');
                return response.send('looks good');
            }).catch(err => {
                console.log(err)
            });
    } else {
        return admin.firestore().collection('courts').where('courtName', '==', courtName).get()
            .then(querySnapshot => {
                const courtRef = querySnapshot.docs[0].ref;
                return admin.firestore().collection('bookings').add({
                    court: courtRef,
                    oselly: false,
                    planyoReservationId: request.body.reservation,
                    time: {startTime: startTimeSeconds, endTime: endTimeSeconds}
                });
            }).then(data => {
                console.log('put something on bookings');
                return response.send('looks good');
            })
            .catch(err => {
                console.log(err);
            });
    }
});

exports.planyoWebhookReservationCancelled = functions.https.onRequest((request, response) => {
    console.log(request.body);
    let emails = [];
    if (moment(request.body.start_time).hour() >= 17) { // if start time after 5pm
        const startTimeEmail = moment(request.body.start_time).format('dddd, MMM Do, h:mmA');
        const endTimeEmail = moment(request.body.end_time).format('h:mmA');
        console.log(startTimeEmail);
        emails.push({
            "From": " (Oselly) <info@osellymail.com>",
            "To": "info@osellymail.com",
            // "Tag": "SpotForSale",
            "TemplateAlias": "benchmarkSlot",
            "TemplateModel": {

                "startTime": startTimeEmail,
                "endTime": endTimeEmail,

                "company_name": "Oselly Sports, LLC",
                "company_address": "11965 Hurontario St. Brampton, ON L6Z 4P0"
            },
        });
    } else if ((moment(request.body.start_time).day() === 0 && moment(request.body.start_time).hour() >= 11) ||
        (moment(request.body.start_time).day() === 6 && moment(request.body.start_time).hour() >= 11)) {
        // if start time is on saturday or sunday after 11am
        const startTimeEmail = moment(request.body.start_time).format('dddd, MMM Do, h:mmA');
        const endTimeEmail = moment(request.body.end_time).format('h:mmA');
        console.log(startTimeEmail);
        emails.push({
            "From": " (Oselly) <info@osellymail.com>",
            "To": "info@osellymail.com",
            // "Tag": "SpotForSale",
            "TemplateAlias": "benchmarkSlot",
            "TemplateModel": {

                "startTime": startTimeEmail,
                "endTime": endTimeEmail,

                "company_name": "Oselly Sports, LLC",
                "company_address": "11965 Hurontario St. Brampton, ON L6Z 4P0"
            },
        });
    }

    return admin.firestore().collection('bookings').where('planyoReservationId', '==', request.body.reservation).get()
        .then(querySnapshot => {
           let promisesToDeleteBookings = [];
            for (var i = 0; i < querySnapshot.docs.length; i++) {
                console.log(querySnapshot.docs[i].id);
                promisesToDeleteBookings.push(admin.firestore().collection('bookings').doc(querySnapshot.docs[i].id).delete());
            }
            console.log(promisesToDeleteBookings);
            return Promise.all(promisesToDeleteBookings);
        }).then(data => {
            console.log('deleted booking off bookings col');
            return response.send('looks good');
            // return true;
        }).then(data => {
            if (emails.length !== 0) {
                console.log('cancellation we care about');
                // return client.sendEmailBatchWithTemplates(emails);
                return true;
            } else {
                console.log('cancellation we dont care about');
                return true;
            }
        }).catch(err => {
            console.log(err);
        });
});

exports.planyoWebhookReservationModified = functions.https.onRequest((request, response) => {
    console.log(request.body);
    let bookingId;
    let courtRef;
    let offset;

    if (moment().tz('America/Toronto').isDST() === true) {
        offset = 4;
    } else {
        offset = 5;
    }

    const startTimeSeconds = moment.unix(request.body.start).add(offset, 'hours').toDate();
    const endTimeSeconds = moment.unix(request.body.end).add(offset, 'hours').toDate();
    const courtName = request.body.unit_names;

    return admin.firestore().collection('bookings').where('planyoReservationId', '==', request.body.reservation).get()
        .then(querySnapshot => {
            let promisesToDeleteBookings = [];
            for (var i = 0; i < querySnapshot.docs.length; i++) {
                promisesToDeleteBookings.push(admin.firestore().collection('bookings').doc(querySnapshot.docs[i].id).delete());
            }
            return Promise.all(promisesToDeleteBookings);
        }).then(data => {
            console.log('deleted booking off bookings col');
            if (request.body.resource === environment.planyoFullGymRentalResourceId.toString()) { // full gym booked
                return admin.firestore().collection('courts').get()
                    .then(querySnapshot => {
                        let courtRefs = [];
                        querySnapshot.forEach(courtQueryDocSnapShot => { // this only works if benchmark is only gym
                            courtRefs.push(courtQueryDocSnapShot.ref);
                        });
                        return courtRefs;
                    }).then(courtRefs => {
                        let promisesToAddBookings = [];
                        for (var i = 0; i < courtRefs.length; i++) {
                            promisesToAddBookings.push(admin.firestore().collection('bookings').add({
                                court: courtRefs[i],
                                oselly: false,
                                planyoReservationId: request.body.reservation,
                                time: {startTime: startTimeSeconds, endTime: endTimeSeconds}
                            }));
                        }
                        return Promise.all(promisesToAddBookings);
                    }).then(data => {
                        console.log('full gym rental booking added looks like');
                        return response.send('looks good');
                    }).catch(err => {
                        console.log(err)
                    });
            } else {
                return admin.firestore().collection('courts').where('courtName', '==', courtName).get()
                    .then(querySnapshot => {
                        const courtRef = querySnapshot.docs[0].ref;
                        return admin.firestore().collection('bookings').add({
                            court: courtRef,
                            oselly: false,
                            planyoReservationId: request.body.reservation,
                            time: {startTime: startTimeSeconds, endTime: endTimeSeconds}
                        });
                    }).then(data => {
                        console.log('put something on bookings');
                        return response.send('looks good');
                    }).catch(err => {
                        console.log(err);
                    });
        }}).catch(err => {
            console.log(err);
        });
});

exports.expireBookingBecauseMaxPplReached = functions.https.onCall((data, context) => {
    console.log(data);
    console.log(context);
    return admin.firestore().collection('bookings').doc(data.gameId).collection('booking-expired-col').doc('booking-expired-doc').update({bookingExpired: true});
});

exports.loginRegPaymentInfoGiven = functions.https.onCall((data, context) => {
    console.log(data);
    console.log(context);
    return stripe.customers.create({
        source: data.tokenId,
        email: data.email
    }).then((customer) => {
        return admin.firestore().collection('users').doc(data.userId).update({
            customerId: customer.id,
            givenPaymentInfo: true
        });
    }).then(data => {
        console.log('payment info added' + data);
        return true;
    }).catch(err => {
        console.log('somethign went wrong ' + err);
        return {error: err}
    });

});

exports.connectGymAccount = functions.https.onCall((data, context) => {
    return axios.post('https://connect.stripe.com/oauth/token', {
        client_secret: environment.stripeKey,
        code: data.authCodeStripe,
        grant_type: 'authorization_code',
    }).then(response => {
        return admin.firestore().collection('gyms').doc(data.gymUid).update({accountId: response.data.stripe_user_id});
    }).then(data => {
        console.log('stripe account Id loaded');
        return true;
    }).catch(error => {
        console.log(error);
    });
});

exports.paymentInfoGivenUpdateUserCol = functions.https.onCall((data, context) => {
    return stripe.customers.create({
        source: data.tokenId,
        email: data.email,
    }).then((customer) => {
        return admin.firestore().collection('users').doc(data.userId).update({
            customerId: customer.id,
            givenPaymentInfo: true
        });
    }).then(res => {
        console.log('everything went through' + res);
        return true;
    }).catch((error) => {
        console.log('Something didnt work: ', error);
        return {error: error}
    });
});

exports.paymentInfoGivenReplace = functions.https.onCall((data, context) => {
    return stripe.customers.create({
        source: data.tokenId,
        email: data.email,
    }).then((customer) => {
        return admin.firestore().collection('users').doc(data.userId).update({
            customerId: customer.id,
            givenPaymentInfo: true
        });
    }).then(data => {
        console.log('payment info added' + data);
        return true;
    }).catch((error) => {
        console.log('something went wrong: ' + error);
        return {error: error}
    });
});

exports.notifyPplThatUserTryingToSellSpot = functions.https.onCall((data, context) => {
    let playerEmails = [];
    let playerUids = [];
    let playerUnsubs = [];
    let playerFirstNames = [];
    let emails = [];
    let spotSellerFullName;
    let spotSellerFirstName;
    let startTimeEmail;
    let endTimeEmail;

    return Promise.all([
        admin.firestore().collection('bookings').doc(data.gameId).collection('host').get(),
        admin.firestore().collection('bookings').doc(data.gameId).collection('semiHosts').get(),
        admin.firestore().collection('bookings').doc(data.gameId).collection('members').get(),
        admin.firestore().collection('bookings').doc(data.gameId).get(),
    ]).then(playersCols => {
        if (playersCols[3].data().spotForSaleEmailSent === true) {
            // exit out of this entire cloud function immediately
            throw new Error('didnt need to execute rest of function');
        } else {
            playersCols[0].forEach(host => {
                playerEmails.push(host.data().email);
                playerUids.push(host.id);
                const name = host.data().name;
                const firstNameAttempt = name.substr(0,name.indexOf(' '));
                if (firstNameAttempt === '') { // incase name is one word like 'Kuzaxe' or something
                    playerFirstNames.push(name);
                } else {
                    playerFirstNames.push(firstNameAttempt);
                }
                if (host.data().unsubs !== undefined) {
                    playerUnsubs.push(host.data().unsubs);
                } else {
                    playerUnsubs.push([]);
                }
            });
            playersCols[1].forEach(semiHost => {
                playerEmails.push(semiHost.data().email);
                playerUids.push(semiHost.id);
                const name = semiHost.data().name;
                const firstNameAttempt = name.substr(0,name.indexOf(' '));
                if (firstNameAttempt === '') { // incase name is one word like 'Kuzaxe' or something
                    playerFirstNames.push(name);
                } else {
                    playerFirstNames.push(firstNameAttempt);
                }
                if (semiHost.data().unsubs !== undefined) {
                    playerUnsubs.push(semiHost.data().unsubs);
                } else {
                    playerUnsubs.push([]);
                }
            });
            playersCols[2].forEach(member => {
                playerEmails.push(member.data().email);
                playerUids.push(member.id);
                const name = member.data().name;
                const firstNameAttempt = name.substr(0,name.indexOf(' '));
                if (firstNameAttempt === '') { // incase name is one word like 'Kuzaxe' or something
                    playerFirstNames.push(name);
                } else {
                    playerFirstNames.push(firstNameAttempt);
                }
                if (member.data().unsubs !== undefined) {
                    playerUnsubs.push(member.data().unsubs);
                } else {
                    playerUnsubs.push([]);
                }
            });

            startTimeEmail = moment(playersCols[3].data().time.startTime.toDate()).tz('America/Toronto').format('dddd, MMM Do, h:mmA');
            endTimeEmail = moment(playersCols[3].data().time.endTime.toDate()).tz('America/Toronto').format('h:mmA');

            return admin.firestore().collection('users').doc(data.sellerUid).get();
        }
    }).then(docSnapshot => {
        spotSellerFullName = docSnapshot.data().name;
        const nameFragments = spotSellerFullName.split(' ');
        spotSellerFirstName = nameFragments[0];
        let replaceLink = data.windowLocationOrigin + '/replace?game=' + data.gameId + '&' + 'seller=' + data.sellerUid;
        let fulfilledGamesLink = data.windowLocationOrigin +  '/goneThrough';

        for (var i = 0; i < playerFirstNames.length; i++) {
            if (playerUnsubs[i].includes('spotForSale') === false) {
                const notifLink = 'https://oselly.com/profile?random=' + playerUids[i];
                if (environment.isTest === true) {
                    emails.push({
                        "From": "" + spotSellerFullName + " (Oselly) <info@osellymail.com>",
                        "To": "info@osellymail.com",
                        "Tag": "SpotForSale",
                        "TemplateAlias": "comment-notification-2",
                        "TemplateModel": {
                            "user_first_name": playerFirstNames[i],
                            "spotSeller_firstName": spotSellerFirstName,
                            "startTime": startTimeEmail,
                            "endTime": endTimeEmail,
                            "spotSeller_replaceLink": replaceLink,
                            "fulfilledGames_link": fulfilledGamesLink,
                            "notifications_url": notifLink,
                            "company_name": "Oselly Sports, LLC",
                            "company_address": "11965 Hurontario St. Brampton, ON L6Z 4P0"
                        },
                    });
                } else {
                    emails.push({
                        "From": "" + spotSellerFullName + " (Oselly) <info@osellymail.com>",
                        "To": playerEmails[i],
                        "Tag": "SpotForSale",
                        "TemplateAlias": "comment-notification-2",
                        "TemplateModel": {
                            "user_first_name": playerFirstNames[i],
                            "spotSeller_firstName": spotSellerFirstName,
                            "startTime": startTimeEmail,
                            "endTime": endTimeEmail,
                            "spotSeller_replaceLink": replaceLink,
                            "fulfilledGames_link": fulfilledGamesLink,
                            "notifications_url": notifLink,
                            "company_name": "Oselly Sports, LLC",
                            "company_address": "11965 Hurontario St. Brampton, ON L6Z 4P0"
                        },
                    });
                }
            } else {
                console.log(playerFirstNames[i] + ' is unsubbed from this email');
            }

        }
        return client.sendEmailBatchWithTemplates(emails);
    }).then(res => {
        console.log('emails to notify users of spot seller sent out looks like');
        return admin.firestore().collection('bookings').doc(data.gameId).update({spotForSaleEmailSent: true});
    }).catch(err => {
        console.log(err);
    });
});

exports.conductReplace = functions.https.onCall((data, context) => {
    console.log('sellerUid: ', data.sellerUid);
    console.log('gameId: ', data.gameId);
    let sellerName = '';
    let sellerUnsubs;

    return Promise.all([
        admin.firestore().collection('bookings').doc(data.gameId).collection('host').get().then((hostCol) => {
            hostCol.forEach(host => {
                if (host.id === data.sellerUid) {
                    sellerName = host.data().name;
                    if (host.data().unsubs !== undefined) {
                        sellerUnsubs = host.data().unsubs;
                    }
                    admin.firestore().collection('bookings').doc(data.gameId).collection('host').doc(data.sellerUid).delete();
                }
            });
        }),
        admin.firestore().collection('bookings').doc(data.gameId).collection('semiHosts').get().then((semiHostsCol) => {
            semiHostsCol.forEach(semiHost => {
                if (semiHost.id === data.sellerUid) {
                    sellerName = semiHost.data().name;
                    if (semiHost.data().unsubs !== undefined) {
                        sellerUnsubs = semiHost.data().unsubs;
                    }
                    admin.firestore().collection('bookings').doc(data.gameId).collection('semiHosts').doc(data.sellerUid).delete();
                }
            });
        }),
        admin.firestore().collection('bookings').doc(data.gameId).collection('members').get().then((membersCol) => {
            membersCol.forEach(member => {
                if (member.id === data.sellerUid) {
                    sellerName = member.data().name;
                    if (member.data().unsubs !== undefined) {
                        sellerUnsubs = member.data().unsubs;
                    }
                    admin.firestore().collection('bookings').doc(data.gameId).collection('members').doc(data.sellerUid).delete();
                }
            });
        }),
    ]).then(gameData => {
        console.log('seller has been taken out of game' + gameData);
        return admin.firestore().collection('users').doc(data.sellerUid)
            .update({fulfilledGames: admin.firestore.FieldValue.arrayRemove(data.gameId)});
    }).then(result => {
        console.log('took gameId out of sellers fulfilled games');
        return admin.firestore().collection('users').doc(data.sellerUid).get();
    }).then(res => {
        const nameFragments = sellerName.split(' ');
        sellerName = nameFragments[0];

        let sellerEmail;
        if (res.data().emailPreferred !== undefined) {
            sellerEmail = res.data().emailPreferred;
        } else {
            sellerEmail = res.data().email;
        }
        console.log('sellers email: ' + sellerEmail);
        if (sellerUnsubs === undefined) {
            sellerUnsubs = [];
        }

        if (sellerUnsubs.includes('spotBought') === false) {
            const notifLink = 'https://oselly.com/profile?random=' + data.sellerUid;
            if (environment.isTest === true) {
                const msg = {
                    "From": "Oselly <info@osellymail.com>",
                    "To": "info@osellymail.com", // sellerEmail
                    "Tag": "SpotBought",
                    "TemplateAlias": "comment-notification-3",
                    "TemplateModel": {
                        "user_first_name": sellerName,
                        "notifications_url": notifLink,
                        "product_name": "Oselly Basketball",
                        "company_name": "Oselly Sports, LLC",
                        "company_address": "11965 Hurontario St. Brampton, ON L6Z 4P0"
                    },
                };
                return client.sendEmailWithTemplate(msg);
            } else {
                const msg = {
                    "From": "Oselly <info@osellymail.com>",
                    "To": sellerEmail,
                    "Tag": "SpotBought",
                    "TemplateAlias": "comment-notification-3",
                    "TemplateModel": {
                        "user_first_name": sellerName,
                        "notifications_url": notifLink,
                        "product_name": "Oselly Basketball",
                        "company_name": "Oselly Sports, LLC",
                        "company_address": "11965 Hurontario St. Brampton, ON L6Z 4P0"
                    },
                };
                return client.sendEmailWithTemplate(msg);
            }
        } else {
            console.log(sellerName + ' is unsubbed from this email');
            return true;
        }
    }).then(data => {
        if (data === true) {
            console.log('no email sent bc ' + sellerName + ' was unsubbed to this email');
        } else {
            console.log('notification email sent to successful seller lloks like');
        }
        return true;
    }).catch(err => {
        console.log(err);
    });
});


exports.cancelBookingForHost = functions.https.onCall((data, context) => {
    console.log(data);

    let playerEmails = []; // this is the one
    let playerUnsubs = [];
    let playerUserIds = [];
    let playerNames = [];
    let playerFirstNames = [];
    let emails = [];
    let hostName = '';
    let pplIn = [];
    let startTimeEmail;
    let endTimeEmail;

    let hosts = [];
    let semiHosts = [];
    let members = [];

    return Promise.all([
        admin.firestore().collection('bookings').doc(data.gameId).collection('host').get(),
        admin.firestore().collection('bookings').doc(data.gameId).collection('semiHosts').get(),
        admin.firestore().collection('bookings').doc(data.gameId).collection('members').get(),
        admin.firestore().collection('bookings').doc(data.gameId).get(),
    ]).then(playersCols => {

        playersCols[0].forEach(host => {
            const hostObj = {
                uid: host.id,
                name: host.data().name,
                email: host.data().email
            };
            hosts.push(hostObj);

            playerEmails.push(host.data().email);
            playerUserIds.push(host.id);
            playerNames.push(host.data().name);
            hostName = host.data().name;
            const nameFragments = host.data().name.split(' ');
            playerFirstNames.push(nameFragments[0]);
            pplIn.push({name: host.data().name, inviter: 'himself'});
            if (host.data().unsubs !== undefined) {
                playerUnsubs.push(host.data().unsubs);
            } else {
                playerUnsubs.push([]);
            }
        });
        playersCols[1].forEach(semiHost => {
            const semiHostObj = {
                uid: semiHost.id,
                name: semiHost.data().name,
                email: semiHost.data().email
            };
            semiHosts.push(semiHostObj);

            playerEmails.push(semiHost.data().email);
            playerUserIds.push(semiHost.id);
            playerNames.push(semiHost.data().name);
            const nameFragments = semiHost.data().name.split(' ');
            playerFirstNames.push(nameFragments[0]);
            pplIn.push({name: semiHost.data().name, inviter: hostName});
            if (semiHost.data().unsubs !== undefined) {
                playerUnsubs.push(semiHost.data().unsubs);
            } else {
                playerUnsubs.push([]);
            }
        });
        playersCols[2].forEach(member => {
            const memberObj = {
                uid: member.id,
                name: member.data().name,
                email: member.data().email,
            };
            members.push(memberObj);

            playerEmails.push(member.data().email);
            playerUserIds.push(member.id);
            playerNames.push(member.data().name);
            const nameFragments = member.data().name.split(' ');
            playerFirstNames.push(nameFragments[0]);
            pplIn.push({name: member.data().name, inviter: member.data().invitedBy});
            if (member.data().unsubs !== undefined) {
                playerUnsubs.push(member.data().unsubs);
            } else {
                playerUnsubs.push([]);
            }
        });

        startTimeEmail = moment(playersCols[3].data().time.startTime.toDate()).tz('America/Toronto').format('dddd, MMM Do, h:mmA');
        endTimeEmail = moment(playersCols[3].data().time.endTime.toDate()).tz('America/Toronto').format('h:mmA');

        deleteReservationFromPlanyo(playersCols[3].data().planyoReservationId);
        return playersCols[3];
    }).then(game => {
        removeGameIdFromPendingGamesArray(game.id, playerUserIds);
        return admin.firestore().collection('cancelledByHost').doc(game.id).set({
            court: game.data().court,
            date: game.data().date,
            max: game.data().max,
            min: game.data().min,
            maxPplReached: game.data().maxPplReached,
            enoughPplInterested: game.data().enoughPplInterested,
            time: {startTime: game.data().time.startTime, endTime: game.data().time.endTime},
        });
    }).then(result => {
        console.log('cancelledByHost doc created looks like');
        return admin.firestore().collection('cancelledByHost').doc(data.gameId).collection('host').doc(hosts[0].uid).set({
            email: hosts[0].email,
            name: hosts[0].name,
        });
    }).then(result => {
        let promisesToAddSemiHosts = [];
        for (var i = 0; i < semiHosts.length; i++) {
            promisesToAddSemiHosts.push(
                admin.firestore().collection('cancelledByHost').doc(data.gameId).collection('semiHosts').doc(semiHosts[i].uid).set({
                    email: semiHosts[i].email,
                    name: semiHosts[i].name,
                })
            );
        }
        return Promise.all(promisesToAddSemiHosts);
    }).then(result => {
        let promisesToAddMembers = [];
        for (var i = 0; i < members.length; i++) {
            promisesToAddMembers.push(
                admin.firestore().collection('cancelledByHost').doc(data.gameId).collection('members').doc(members[i].uid).set({
                    email: members[i].email,
                    name: members[i].name,
                })
            );
        }
        return Promise.all(promisesToAddMembers);
    }).then(result => {
        return admin.firestore().collection('bookings').doc(data.gameId).collection('booking-expired-col').doc('booking-expired-doc').delete();
    }).then(result => {
        return admin.firestore().collection('bookings').doc(data.gameId).collection('host').doc(hosts[0].uid).delete();
    }).then(result => {
        let promisesToDeleteSemiHosts = [];
        for (var i = 0; i < semiHosts.length; i++) {
            promisesToDeleteSemiHosts.push(
                admin.firestore().collection('bookings').doc(data.gameId).collection('semiHosts').doc(semiHosts[i].uid).delete()
            );
        }
        return Promise.all(promisesToDeleteSemiHosts);
    }).then(result => {
        let promisesToDeleteMembers = [];
        for (var i = 0; i < members.length; i++) {
            promisesToDeleteMembers.push(
                admin.firestore().collection('bookings').doc(data.gameId).collection('members').doc(members[i].uid).delete()
            );
        }
        return Promise.all(promisesToDeleteMembers);
    }).then(result => {
        return admin.firestore().collection('bookings').doc(data.gameId).delete();
    }).then(result => {
        for (var i = 0; i < playerNames.length; i++) {
            if (playerUnsubs[i].includes('gameNotHappening') === false) {
                const notifLink = 'https://oselly.com/profile?random=' + playerUserIds[i];
                if (environment.isTest === true) {
                    emails.push({
                        "From": "Oselly <info@osellymail.com>",
                        "To": "info@osellymail.com",
                        "Tag": "CancelledByHost",
                        "TemplateAlias": "comment-notification-4",
                        "TemplateModel": {
                            "user_first_name": playerFirstNames[i],
                            "slotStartTime": startTimeEmail,
                            "slotEndTime": endTimeEmail,
                            "pplWhoWereIn": pplIn,
                            "host_name": hostName,
                            "notifications_url": notifLink,
                            "company_name": "Oselly Sports, LLC",
                            "company_address": "11965 Hurontario St. Brampton, ON L6Z 4P0"
                        },
                    });
                } else {
                    emails.push({
                        "From": "Oselly <info@osellymail.com>",
                        "To": playerEmails[i],
                        "Tag": "CancelledByHost",
                        "TemplateAlias": "comment-notification-4",
                        "TemplateModel": {
                            "user_first_name": playerFirstNames[i],
                            "slotStartTime": startTimeEmail,
                            "slotEndTime": endTimeEmail,
                            "pplWhoWereIn": pplIn,
                            "host_name": hostName,
                            "notifications_url": notifLink,
                            "company_name": "Oselly Sports, LLC",
                            "company_address": "11965 Hurontario St. Brampton, ON L6Z 4P0"
                        },
                    });
                }
            } else {
                console.log(playerFirstNames[i] + ' is unsubbed from this email');
            }
        }
        return client.sendEmailBatchWithTemplates(emails);
    }).then(result => {
        console.log('cancelledByHost emails sent out looks like');
        return true;
    }).catch(err => {
        console.log('failure to create cancelledByHost doc');
        console.log(err);
    });
});

exports.cancelBookingOnPlanyo = functions.https.onCall((data, context) => {
    console.log(data);
    return admin.firestore().collection('bookings').doc(data.bookingId).get()
        .then(docSnapshot => {
            console.log(docSnapshot.data().planyoReservationId);
            return deleteReservationFromPlanyo(docSnapshot.data().planyoReservationId);
        }).then(res => {
            return admin.firestore().collection('bookings').doc(data.bookingId)
                .collection('confirm-col').doc('confirmMessage').delete();
        }).then(res => {
            return admin.firestore().collection('bookings').doc(data.bookingId).delete();
        }).then(res => {
            return admin.firestore().collection('users').doc(data.uid).get();
        }).then(docSnapshot => {
            if (docSnapshot.data().newBooking === data.bookingId) {
                return admin.firestore().collection('users').doc(data.uid).update({
                    newBooking: admin.firestore.FieldValue.delete()
                });
            } else {
                return true;
            }
        }).then(res => {
            return admin.firestore().collection('users').doc(data.uid).update({
                bookings: admin.firestore.FieldValue.arrayRemove(data.bookingId)
            });
        }).catch(err => {
            console.error(err);
        });
});



exports.makeReservationOnPlanyo = functions.https.onCall((data, context) => {
    // console.log(data);
    // return true;
    const start_time = moment.unix(data.startTimeSeconds).tz('America/Toronto').format('YYYY-MM-DD HH:mm');
    const end_time = moment.unix(data.endTimeSeconds).tz('America/Toronto').format('YYYY-MM-DD HH:mm');
    console.log(start_time);
    console.log(end_time);
    console.log(data.courtName);

    return axios.post('https://www.planyo.com/rest/?method=make_reservation&api_key=' + environment.planyoApiKey, qs.stringify({
        resource_id: environment.planyoCourtRentalResourceId.toString(), // '151253',
        start_time: start_time, // '2019-06-23 19:30',
        end_time: end_time, //'2019-06-23 20:30',
        admin_mode: 'true',
        quantity: '1',
        first_name: 'Oselly',
        assignment1: data.courtName,
        force_status: '4'
    }), {
        headers: {
            'cache-control': 'no-cache',
            Connection: 'keep-alive',
            'accept-encoding': 'gzip, deflate',
            'Cache-Control': 'no-cache',
            Accept: '*/*',
            'Content-Type': 'application/x-www-form-urlencoded'
        }
    }).then(response => {
        // console.log(response);
        // return true;
        console.log(response.data.data.reservation_id);
        const planyoResId = response.data.data.reservation_id;
        return admin.firestore().collection('bookings').doc(data.gameId).update({planyoReservationId: planyoResId})
    }).catch(err => {
        console.error(err);
        return true;
    });
});

exports.listPlanyoReservations = functions.https.onCall((data, context) => {
    return axios.post('https://www.planyo.com/rest/?method=list_reservations&api_key=' + environment.planyoApiKey, qs.stringify({
        // start_time: '2019-12-06 10:30',
        // end_time: '2020-02-02 10:30', // benchmark had 439 reservations from Dec 6th 10:30am till Feb 2nd 10:30am
        // start_time: '2020-02-02 10:30', // benchmark had 126 reservations from Feb 2nd 10:30am till April 2nd 10:30am
        // end_time: '2020-04-02 10:30', // keep in mind that data isnt accurate past april 2nd 10:30am

        // did above dec 6th, doing below jan 19th
        // start_time: '2020-01-16 10:30', // benchmark had 380 reservations from Jan 16th 10:30am till Feb 21st 10:30am
        // end_time: '2020-02-21 10:30',
        // start_time: '2020-02-21 10:30', // benchmark had 380 reservations from Feb 21st 10:30am till April 3rd 10:30am
        // end_time: '2020-04-03 10:30',
        start_time: '2020-04-03 10:30', // benchmark had 373 reservations from April 3rd 10:30am till May 16th 10:30am
        end_time: '2020-05-16 10:30', // keep in mind that data isnt accurate past May 16th 10:30am
        required_status: '4',
    }), {
        headers: {
            'cache-control': 'no-cache',
            Connection: 'keep-alive',
            'accept-encoding': 'gzip, deflate',
            'Cache-Control': 'no-cache',
            Accept: '*/*',
            'Content-Type': 'application/x-www-form-urlencoded'
        }
    }).then(response => {
        console.log(response.data.data.results);
        console.log(response.data.data.results.length);
        // return true;
        return admin.firestore().collection('courts').get()
            .then(querySnapshot => {
                let courtRefs = [];
                querySnapshot.forEach(courtQueryDocSnapShot => { // this only works if benchmark is only gym
                    courtRefs.push(courtQueryDocSnapShot.ref);
                });
                return {reservationsArray: response.data.data.results, courtRefsArray: courtRefs};
            }).then(result => {
                let offset;
                if (moment().tz('America/Toronto').isDST() === true) {
                    offset = 4;
                } else {
                    offset = 5;
                }
                return admin.firestore().runTransaction(t => {
                    const bookingsColRef = admin.firestore().collection('bookings');
                    return t.get(bookingsColRef)
                        .then(querySnapshot => {
                            console.log('gratuitous read');
                            for (var i = 0; i < result.reservationsArray.length; i++) {
                                if (result.reservationsArray[i].resource_id === environment.planyoFullGymRentalResourceId.toString()) {
                                    console.log(result.reservationsArray[i]);
                                    const startTime = moment(result.reservationsArray[i].start_time, "YYYY-MM-DD HH:mm:ss").add(offset, 'hours').toDate();
                                    const endTime = moment(result.reservationsArray[i].end_time, "YYYY-MM-DD HH:mm:ss").add(offset, 'hours').toDate();

                                    for (var j = 0; j < result.courtRefsArray.length; j++) {
                                        const bookingDoc = admin.firestore().collection('bookings').doc(j + 'transaction' + result.reservationsArray[i].reservation_id);
                                        t.set(bookingDoc, {
                                            court: result.courtRefsArray[j],
                                            oselly: false,
                                            planyoReservationId: result.reservationsArray[i].reservation_id,
                                            time: {startTime: startTime, endTime: endTime}});
                                    }
                                } else {
                                    const startTime = moment(result.reservationsArray[i].start_time, "YYYY-MM-DD HH:mm:ss").add(offset, 'hours').toDate();
                                    const endTime = moment(result.reservationsArray[i].end_time, "YYYY-MM-DD HH:mm:ss").add(offset, 'hours').toDate();

                                    if (result.reservationsArray[i].unit_assignment === 'Court #1') {
                                        const bookingDoc = admin.firestore().collection('bookings').doc('transaction' + result.reservationsArray[i].reservation_id);
                                        t.set(bookingDoc, {
                                            court: result.courtRefsArray[1],
                                            oselly: false,
                                            planyoReservationId: result.reservationsArray[i].reservation_id,
                                            time: {startTime: startTime, endTime: endTime}});
                                    } else if (result.reservationsArray[i].unit_assignment === 'Court #2') {
                                        const bookingDoc = admin.firestore().collection('bookings').doc('transaction' + result.reservationsArray[i].reservation_id);
                                        t.set(bookingDoc , {
                                            court: result.courtRefsArray[0],
                                            oselly: false,
                                            planyoReservationId: result.reservationsArray[i].reservation_id,
                                            time: {startTime: startTime, endTime: endTime}});
                                    }
                                }
                            }
                        })
                })
            }).then(res => {
                console.log('transaction success i think');
                return true;
            }).catch(err => {
                console.log(err);
            });
    }).catch(err => {
        console.log(err);
        return true;
    });
});

exports.sendTestEmail = functions.https.onCall((data, context) => {
    const postmark = require("postmark");
// Send an email:
    const client = new postmark.ServerClient("98b45af8-3f05-4125-b488-fdb2b9105bac");
    return client.sendEmailWithTemplate({
        "From": "Nikhil Gandhi via Oselly <support@oselly.com>",
        "To": "support@oselly.com",
        "TemplateAlias": "comment-notification-3",
        "TemplateModel": {
            "user_first_name": "user_first_name_Value",
            "body": "body_Value",
            "attachment_details": [
                {
                    "attachment_url": "attachment_url_Value",
                    "attachment_name": "attachment_name_Value",
                    "attachment_size": "attachment_size_Value",
                    "attachment_type": "attachment_type_Value"
                }
            ],
            "commenter_name": "commenter_name_Value",
            "timestamp": "timestamp_Value",
            "action_url": "action_url_Value",
            "notifications_url": "notifications_url_Value",
            "product_name": "product_name_Value",
            "product_url": "product_url_Value",
            "company_name": "company_name_Value",
            "company_address": "company_address_Value"
        },
        "TextBody": "this is the plainText version and should match the html more or less",

    });
});
