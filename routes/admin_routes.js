var security = require('../libs/security');
var mail = require('../libs/mail');

var User = require('../models/user').User;
var UserStatus = require('../models/user').NPO_STATUS;

var config = require('config');
var npoConfig = config.get('npo');
var serverConfig = config.get('server');

module.exports = function (app) {

    app.get('/admin', security.protectAdminGet, function (req, res, next) {
        res.render('admin/admin_home.jade', {user: req.user});
    });

    app.get('/admin/npo', security.protectAdminGet, function (req, res, next) {
        res.render('admin/admin_npo.jade', {user: req.user});
    });

    app.post('/admin/npo', security.protectAdminGet, function (req, res, next) {
        if (req.body.action && req.body.emails) {
            switch (req.body.action) {
                case 'approve_membership' :
                    var rows = req.body.emails.split('\n');
                    rows.forEach(function (row) {
                        var recipient = row.trim();
                        if (recipient.length > 0) {
                            new User({email: recipient}).fetch().then(function (theUser) {
                                if (theUser == null) {
                                    //TODO handle error.
                                    console.log("User not found!");
                                    return res.render('admin/admin_npo', {errorMessage: 'email ' + recipient + ' not found'});
                                }
                                if (theUser.attributes.membership_status == UserStatus.applied_for_membership) {
                                    theUser.attributes.membership_status = UserStatus.request_approved;
                                    theUser.save().then(function (model) {
                                        var payLink = serverConfig.url + "/he/npo/pay_fee?user='" + recipient;
                                        mail.send(
                                            recipient,
                                            npoConfig.email,
                                            'Your Midburn membership approved!',
                                            'emails/npo_membership_approved',
                                            {name: theUser.fullName, payLink: payLink});
                                        res.redirect('/admin/npo');
                                    });
                                }
                                else {
                                    //TODO handle error.
                                    console.log("Incorrect status - ", theUser.attributes.membership_status);
                                    return res.render('admin/admin_npo', {errorMessage: 'email ' + recipient + ' - incorrect status'});
                                }
                            });
                        }
                    })
            }
        }
    });
};


