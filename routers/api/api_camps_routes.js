const common = require('../libs/common').common,
_ = require('lodash'),
User = require('../models/user').User,
Camp = require('../models/camp').Camp,
CampFile = require('../models/camp').CampFile,
constants = require('../models/constants.js'),
knex = require('../libs/db').knex,
userRole = require('../libs/user_role'),
config = require('config'),
mail = require('../libs/mail'),
mailConfig = config.get('mail'),
csv = require('json2csv'),
awsConfig = config.get('aws_config'),
LOG = require('../libs/logger')(module),
S3 = require('../libs/aws-s3');
const APPROVAL_ENUM = ['approved', 'pending', 'approved_mgr'];
const CONSTS = require('../consts');

/**
 * emailDeliver Moved to services - mail.service
 */
/**
 * __camps_update_status was moved to services - camps.service
 * (campStatusUpdate)
 */
/**
 * Modify_User_AddInfo was moved to services - users.service
 */


module.exports = (app, passport) => {
    /**
     * API: (GET) get user by id
     * request => /users/:id
     */
    // DONE - MOVED TO NEW API.
    // app.get('/users/:id',
    //     [userRole.isLoggedIn(), userRole.isAllowedToViewUser()],
    //     (req, res) => {
    //         User.forge({ user_id: req.params.id }).fetch({ columns: '*' }).then((user) => {
    //             if (user !== null) {
    //                 res.json({ name: user.get('name'), email: user.get('email'), cell_phone: user.get('cell_phone') })
    //             } else {
    //                 res.status(404).json({ message: 'Not found' })
    //             }
    //
    //         }).catch((err) => {
    //             res.status(500).json({
    //                 error: true,
    //                 data: {
    //                     message: err.message
    //                 }
    //             });
    //         });
    //     });
    /**
     * API: (GET) get user by email
     * request => /users/:email
     */
        // DONE - MOVED TO NEW API.
    // app.get('/users/:email',
    //     [userRole.isLoggedIn()],
    //     (req, res) => {
    //         User.forge({ email: req.params.email }).fetch().then((user) => {
    //             if (user !== null) {
    //                 res.status(200).end()
    //             } else {
    //                 res.status(404).end()
    //             }
    //         }).catch((err) => {
    //             res.status(500).json({
    //                 error: true,
    //                 data: {
    //                     message: err.message
    //                 }
    //             });
    //         });
    //     });

    /**
     * CampSave function moved to services - camps.service
     */
    /**
     * __camps_create_camp_obj moved to services - camp.service
     * (createCampObject)
     */
    /**
      * API: (POST) create camp
      * request => /camps/new
      */
    app.post('/camps/new',
        [userRole.isLoggedIn(), userRole.isAllowNewCamp()],
        (req, res) => {
            Camp.forge(__camps_create_camp_obj(req, true)).save().then((camp) => {
                __camps_update_status(req.user.currentEventId,camp.attributes.id, camp.attributes.main_contact, 'approve_new_mgr', req.user, res);
            }).catch((e) => {
                res.status(500).json({
                    error: true,
                    data: {
                        message: e.message
                    }
                });
            });
        });
    /**
       * API: (PUT) edit camp
       * request => /camps/1/edit
       */
    app.put('/camps/:id/edit', userRole.isLoggedIn(), (req, res) => {
        Camp
            .forge({id: req.params.id , event_id: req.user.currentEventId})
            .fetch({ withRelated: ['users_groups'] })
            .then((camp) => {
                camp.getCampUsers((users) => {
                    group_props = camp.parsePrototype(req.user);
                    if (camp.isCampManager(req.user.attributes.user_id) || group_props.isAdmin) {
                        __camps_save(req, false, camp)
                            // Camp.forge({ id: req.params.id }).fetch().then((camp) => {
                            // camp.save(__camps_create_camp_obj(req, false, camp))
                            .then(() => {
                                res.json({ error: false, status: 'Camp updated' });
                                // });
                            }).catch((err) => {
                                res.status(500).json({
                                    error: true,
                                    data: {
                                        message: err.message
                                    }
                                });
                            });
                        // });
                    } else {
                        res.status(401).json({ error: true, status: 'Cannot update camp' });
                    }
                });
            }).catch((err) => {
                res.status(500).json({
                    error: true,
                    data: {
                        message: err.message
                    }
                });
            });
    });

    // PUBLISH
    app.put('/camps/:id/publish',
        [userRole.isAdmin()], // userRole.isAllowEditCamp() is work-in-progress
        (req, res) => {
            // If camp met all its requirements, can publish
            Camp.forge({ id: req.params.id }).fetch().then((camp) => {
                camp.save({ web_published: '1' }).then(() => {
                    res.json({ error: false, status: 'Publish' });
                }).catch((err) => {
                    res.status(500).json({
                        error: true,
                        data: {
                            message: err.message
                        }
                    });
                });
            }).catch((err) => {
                res.status(500).json({
                    error: true,
                    data: {
                        message: err.message
                    }
                });
            });
        });
    // UNPUBLISH
    app.put('/camps/:id/unpublish',
        [userRole.isAdmin()], // userRole.isAllowEditCamp() is work-in-progress
        (req, res) => {
            Camp.forge({ id: req.params.id }).fetch().then((camp) => {
                camp.save({ web_published: '0' }).then(() => {
                    res.json({ error: false, status: 'Unpublish' });
                }).catch((err) => {
                    res.status(500).json({
                        error: true,
                        data: {
                            message: err.message
                        }
                    });
                });
            }).catch((err) => {
                res.status(500).json({
                    error: true,
                    data: {
                        message: err.message
                    }
                });
            });
        });

    /**
     * approve user request
     */
    app.get('/camps/:camp_id/members/:user_id/:action', userRole.isLoggedIn(), (req, res) => {
        var user_id = req.params.user_id;
        var camp_id = req.params.camp_id;
        var action = req.params.action;
        var actions = ['approve', 'remove', 'revive', 'reject', 'approve_mgr', 'remove_mgr', 'pre_sale_ticket'];
        if (actions.indexOf(action) > -1) {
            __camps_update_status(req.user.currentEventId, camp_id, user_id, action, req.user, res);
        } else {
            res.status(404).json({ error: true, data: { message: "illegal command (" + action + ")" } });
        }
    })

    app.post('/camps/:camp_id/documents/:doc_type/', userRole.isLoggedIn(), async (req, res) => {

        const camp_id = req.params.camp_id,
             doc_type = req.params.doc_type

        // Check that the document type is valid
        if (!CONSTS.CAMPS.FILE_TYPES.includes(doc_type)) {
            return res.status(400).json({
                 error: true,
                 data: {
                     message: 'Invalid document type'
                 }
             })
        }

        let camp = await Camp.forge({id: camp_id}).fetch({withRelated: ['files']})

        if (!camp) {
            return res.status(500).json({
                error: true,
                message: 'Camp Id does not exist'
            })
        }

        let data;
        try {
            data = req.files.file.data;
        } catch (err) {
            return res.status(400).json({
                error: true,
                message: 'No file attached to request'
            })
        }
        let fileName = `${camp.attributes.camp_name_en}/${doc_type}_${req.files.file.name}`

        let s3Client = new S3();
        // Upload the file to S3
        try {
            await s3Client.uploadFileBuffer(fileName, data, awsConfig.buckets.camp_file_upload)
        } catch (err) {
            LOG.error(err.message);
            return res.status(500).json({
                error: true,
                message: 'S3 Error: could not put file in S3'
            })
        }

        // Get the URL for the file, so we can save to DB
        let filePath = s3Client.getObjectUrl(fileName, awsConfig.buckets.camp_file_upload)

        // Add the file to the camp_files table
        // If the file type exists, update
        // If not, insert a new file record
        let existingFile = camp.relations.files.models.find((file) => {
            if (file.attributes.file_type === doc_type) {
                return file
            }
        })

        try {
            if (!existingFile) {
                    await new CampFile({
                        created_at: (new Date()).toISOString().substring(0, 19).replace('T', ' '),
                        updated_at: (new Date()).toISOString().substring(0, 19).replace('T', ' '),
                        camp_id: camp.attributes.id,
                        uploader_id: req.user.id,
                        file_path: filePath,
                        file_type: doc_type
                    }).save()
            } else {
                existingFile.attributes.updated_at = (new Date()).toISOString().substring(0, 19).replace('T', ' ')
                existingFile.attributes.uploader_id = req.user.id
                existingFile.attributes.file_path = filePath

                await existingFile.save()
            }
        } catch (err) {
            LOG.error(err.message);
            return res.status(500).json({
                error: true,
                message: 'DB Error: could not connect or fetch data'
            })
        }

        return res.status(200).json({
            error: false
        })
    })

    app.get('/camps/:camp_id/documents/:doc_type/', userRole.isLoggedIn(), async (req, res) => {
        const camp_id = req.params.camp_id,
        doc_type = req.params.doc_type

        // Check that the document type is valid
        if (!CONSTS.CAMPS.FILE_TYPES.includes(doc_type)) {
            return res.status(400).json({
                 error: true,
                 data: {
                     message: 'Invalid document type'
                 }
             })
        }

        let camp = await Camp.forge({id: camp_id}).fetch({withRelated: ['files']})

        if (!camp) {
            return res.status(500).json({
                error: true,
                message: 'Camp Id does not exist'
            })
        }

        let existingFile = camp.relations.files.models.find((file) => {
            if (file.attributes.file_type === doc_type) {
                return file
            }
        })

        if (existingFile) {
            return res.status(200).json({
                error: false,
                path: existingFile.attributes.file_path
            })
        } else {
            return res.status(404).json({
                error: true,
                message: 'File does not exist'
            })
        }
    })

    /**
     * API: (GET) return camp's contact person with:
     * name_en, name_he, email, phone
     * request => /camps_contact_person/:id
     */
    app.get('/camps_contact_person/:id', (req, res, next) => {
        User.forge({ user_id: req.params.id }).fetch({
            require: true,
            columns: ['first_name', 'last_name', 'email', 'cell_phone']
        }).then((user) => {
            res.status(200).json({ user: user.toJSON() })
        }).catch((err) => {
            res.status(500).json({
                error: true,
                data: {
                    message: err.message
                }
            });
        });
    });

    /**
     * API: (GET) return indication if camp exist, provide camp_name_en
     * request => /camps/<camp_name_en>
     */
    app.get('/camps/:camp_name_en', userRole.isLoggedIn(), (req, res) => {
        var req_camp_name_en = req.params.camp_name_en;
        Camp.forge({ camp_name_en: req_camp_name_en }).fetch().then((camp) => {
            if (camp === null) {
                // camp name is available
                res.status(204).end();
            } else {
                res.status(200).end();
            }
        }).catch((e) => {
            res.status(500).json({
                error: true,
                data: {
                    message: e.message
                }
            });
        });
    });

    /**
     * API: (GET) return active user list.
     *  if req.user.isAdmin - return all users
     *  if req.user.isCampManager - return all users from all camps
     *  else return req.user
     * request => /users
     */
    // MOVED TO NEW API.
    // app.get('/users', (req, res) => {
    //     if (req.user.isAdmin) {
    //         User.where('validated', '=', '1').fetchAll().then((users) => {
    //             var _users = users.toJSON();
    //             for (var i in _users) {
    //                 common.__updateUserRec(_users[i]);
    //             }
    //             res.status(200).json({ users: _users })
    //         }).catch((err) => {
    //             res.status(500).json({
    //                 error: true,
    //                 data: {
    //                     message: err.message
    //                 }
    //             });
    //         });
    //     } else {
    //         res.status(200).json({ users: [req.user.toJSON()] })
    //     }
    // });

    /**
     * API: (GET) return camps list
     * request => /camps
     */
    app.get('/camps', (req, res) => {
        Camp.where('status', '=', 'open', 'AND', 'event_id', '=', req.user.currentEventId, 'AND', '__prototype', '=', constants.prototype_camps.THEME_CAMP.id).fetchAll().then((camp) => {
            if (camp !== null) {
                res.status(200).json({ camps: camp.toJSON() })
            } else {
                res.status(404).json({ data: { message: 'Not found' } })
            }
        }).catch((err) => {
            res.status(500).json({
                error: true,
                data: {
                    message: err.message
                }
            });
        });
    });

    function getFields(input, field) {
        var output = [];
        for (var i=0; i < input.length; ++i) {
            output.push(input[i][field]);
        }
        return output;
    }

    const retrieveDataForPresale = () => {
        //the emails of all users with presale tickets
        return knex(constants.USERS_TABLE_NAME).select(constants.USERS_TABLE_NAME+'.email')
        .innerJoin(constants.CAMP_MEMBERS_TABLE_NAME,constants.CAMP_MEMBERS_TABLE_NAME+'.user_id', constants.USERS_TABLE_NAME+'.user_id')
        .innerJoin(constants.CAMPS_TABLE_NAME,constants.CAMP_MEMBERS_TABLE_NAME+'.camp_id', constants.CAMPS_TABLE_NAME+'.id')
        .whereRaw("camp_members.addinfo_json->'$.pre_sale_ticket'='true'").then(emails => {
            emails_array = getFields(emails,"email")
            console.log(emails)
            console.log(emails_array)
            if (!_.isUndefined(emails)) {
                return {
                    status: 200,
                        data: {
                            emails_array
                    }
                };
            } else {
                return {
                    status: 404,
                    data: { data: { message: 'Not found' } }
                };
            }
        }).catch(err => {
            return {
                status: 500,
                data: {
                    error: true,
                    data: { message: err.message }
                }
            };
        });
    }

    const retrieveDataFor = (group_proto,user) => {
        return Camp.query((query) => {
            query
                .select('camps.*', 'users_groups.entrance_quota')
                .leftJoin('users_groups', 'camps.id', 'users_groups.group_id')
                .where({ 'camps.event_id': user.currentEventId , 'camps.__prototype': group_proto })
        })
            .orderBy('camp_name_en', 'ASC')
            .fetchAll()
            .then(camp => {
                if (!_.isUndefined(camp)) {
                    return {
                        status: 200,
                        data: {
                            camps: camp.toJSON()
                        }
                    };
                } else {
                    return {
                        status: 404,
                        data: { data: { message: 'Not found' } }
                    };
                }
            }).catch(err => {
                return {
                    status: 500,
                    data: {
                        error: true,
                        data: { message: err.message }
                    }
                };
            });
    }
    // /**
    //  * API: (GET) return camps list
    //  * request => /camps_open
    //  */
    app.get('/camps_all', [userRole.isCampsAdmin()],
        (req, res) => retrieveDataFor(constants.prototype_camps.THEME_CAMP.id,req.user).then(result => res.status(result.status).json(result.data)));

    app.get('/prod_dep_all', userRole.isProdDepsAdmin(),
        (req, res) => retrieveDataFor(constants.prototype_camps.PROD_DEP.id,req.user).then(result => res.status(result.status).json(result.data)));

    app.get('/art_all', userRole.isArtInstallationsAdmin(),
        (req, res) => retrieveDataFor(constants.prototype_camps.ART_INSTALLATION.id,req.user).then(result => res.status(result.status).json(result.data)));

    /**
     * API: (GET) return camps list csv format
     * request => /camps_csv
     */
    app.get('/camps_csv/:ActionType', userRole.isAdmin(), (req, res) => {
        const csv_fields = ['email']

        const actionType = req.params.ActionType

        if (actionType === "theme_camps") {
            retrieveDataFor(constants.prototype_camps.THEME_CAMP.id).then(result => {
                let csvRes = csv({ data: result.data })
                res.setHeader('Content-Disposition', 'attachment; filename=camps.csv')
                res.set('Content-Type', 'text/csv')
                res.status(200).send(csvRes)
            })
        }
        else {
            retrieveDataForPresale().then(result => {

                try {
                    var csv_file = csv({ data: result, fields: csv_fields })
                  } catch (err) {
                    // Errors are thrown for bad options, or if the data is empty and no fields are provided.
                    // Be sure to provide fields if it is possible that your data array will be empty.
                    console.error(err);
                  }

                res.setHeader('Content-Disposition', 'attachment; filename=presaletickets.csv');
                res.set('Content-Type', 'text/csv');
                res.send(csv_file);
                res.status(200);
            })
        }
    });
    /**
     * API: (GET) return camps list which are open to new members
     * request => /camps_open
     */
    app.get('/camps_open', userRole.isLoggedIn(), (req, res) => {
        let allowed_status = ['open', 'closed'];
        let web_published = [true, false];
        Camp.query((query) => {
            query
                .where('event_id', '=', req.user.currentEventId , 'AND', '__prototype', '=', constants.prototype_camps.THEME_CAMP.id)
                .whereIn('status', allowed_status)
                .whereIn('web_published', web_published);
        })
            .fetchAll().then((camp) => {
                if (camp !== null) {
                    res.status(200).json({ camps: camp.toJSON() })
                } else {
                    res.status(404).json({ data: { message: 'Not found' } })
                }
            }).catch((err) => {
                res.status(500).json({
                    error: true,
                    data: {
                        message: err.message
                    }
                });
            });
    });

    /**
     * API: (GET) camp join request
     * params: camp_id
     * request => /camps/2/join
     */
    app.get('/camps/:id/join', userRole.isLoggedIn(), (req, res) => {
        var user = {
            id: req.user.attributes.user_id,
            full_name: [req.user.attributes.first_name, req.user.attributes.last_name].join(', '), //TODO: use user.fullName instead
            email: req.user.attributes.email
        }
        var camp = {
            id: req.params.id,
            manager_email: '' // later to be added
        };
        // User is camp free and doesn't have pending join request
        // User details will be sent to camp manager for approval
        req.user.getUserCamps((camps) => {
            if (req.user.isCampFree) {
                // Fetch camp manager email address
                Camp.forge({ id: req.params.id, event_id: req.user.currentEventId , __prototype: constants.prototype_camps.THEME_CAMP.id }).fetch({
                }).then((camp) => {
                    camp.getCampUsers((users) => {
                        if (camp.managers.length > 0) {
                            user.camp_id = camp.attributes.id;
                            res.status(200).json({
                                data: {
                                    user: user,
                                    camp: {
                                        id: camp.attributes.id,
                                        manager_id: camp.attributes.managers[0].user_id,
                                        manager_email: camp.attributes.managers[0].email
                                    }
                                }
                            });
                        } else {
                            res.status(404).json({
                                data: { message: 'Couldn\'t find camp manager' }
                            });
                        }
                    });
                }).catch((e) => {
                    res.status(500).json({
                        error: true,
                        data: {
                            message: 'Failed to fetch camp ' + camp.id
                        }
                    });
                });
            } else {
                // User cannot join another camp
                res.status(404).json({ data: { message: 'User can only join one camp!' } })
            }
        });
    });

    /**
     * Deliver join request email to camp manager
     * @type {[type]}
     */
    app.all('/camps/:id/join/deliver', userRole.isLoggedIn(), (req, res) => {
        var user_id = req.user.attributes.user_id;
        var camp_id = req.params.id;
        __camps_update_status(req.user.currentEventId, camp_id, user_id, 'join', user_id, res);
    });

    //MOVED TO NEW API
    // /**
    //  * User request to cancel camp-join request
    //  */
    // app.get('/users/:id/join_cancel', userRole.isLoggedIn(), (req, res) => {
    //     var user_id = req.user.attributes.user_id;
    //     var camp_id = req.params.id;
    //     __camps_update_status(req.user.currentEventId, camp_id, user_id, 'join_cancel', user_id, res);
    // });
    //
    // /**
    //  * User request to cancel camp-join pending
    //  */
    // app.get('/users/:id/join_approve', userRole.isLoggedIn(), (req, res) => {
    //     var user_id = req.user.attributes.user_id;
    //     var camp_id = req.params.id;
    //     __camps_update_status(req.user.currentEventId, camp_id, user_id, 'join_mgr', user_id, res);
    // });

    // DONE - MOVED TO API
    // app.get('/users/:user_id/join_details', userRole.isLoggedIn(), (req, res) => {
    //     if (req.user.isAdmin || req.user.attributes.user_id === parseInt(req.params.user_id)) {
    //         User.forge({ user_id: req.params.user_id }).fetch().then((user) => {
    //             //this user is not the one is logged in, so the current event Id does not exixts
    //             //we need to add it from the logged user so getUserCamps will know what to search for
    //             user.currentEventId = req.user.currentEventId
    //             user.getUserCamps((camps) => {
    //                 var camp = user.attributes.camp;
    //                 if (user.attributes.camp) {
    //                     res.status(200).json({
    //                         details: // camp,
    //                         {
    //                             user_id: user.attributes.user_id,
    //                             camp_id: camp.id,
    //                             status: camp.member_status,
    //                             member_status: camp.member_status,
    //                             member_status_i18n: camp.member_status_i18n,
    //                             camp_name_en: camp.camp_name_en,
    //                             camp_name_he: camp.camp_name_he,
    //                         }
    //                     });
    //                 } else {
    //                     res.status(404).json({
    //                         error: true,
    //                         data: {
    //                             message: 'Couldnt find user available camp',
    //                         }
    //                     });
    //                 }
    //             }, req.t);
    //         });
    //     } else {
    //         res.status(404).json({
    //             error: true,
    //             data: {
    //                 message: 'Access denied for user',
    //             }
    //         });
    //     }
    // });

    /**
     * API: (POST) create Program
     * request => /camps/program
     */
    app.post('/camps/program', (req, res) => {
        console.log(success);
        //TODO
    });

    /**
     * API: (GET) return camp members without details
     * request => /camps/1/members/count
     */
    app.get('/camps/:id/members/count', userRole.isLoggedIn(), (req, res) => {
        Camp.forge({ id: req.params.id }).fetch({ withRelated: ['members'] }).then((camp) => {
            res.status(200).json({ members: camp.related('members').toJSON() })
        })
    })

    /**
     * API: (GET) return camp members with details
     * request => /camps/1/members
     */
    app.get('/camps/:id/members', userRole.isLoggedIn(), (req, res) => {
        Camp.forge({id: req.params.id , event_id: req.user.currentEventId}).fetch().then((camp) => {
            camp.getCampUsers((members) => {
                var isCampManager = camp.isCampManager(req.user.id, req.t);
                if (!req.user.isAdmin) {
                    members = members.map(function (member) {
                        if (APPROVAL_ENUM.indexOf(member.member_status) < 0) {
                            member.cell_phone = '';
                            member.name = '';
                        }

                        delete member.first_name;
                        delete member.last_name;
                        delete member.gender;
                        delete member.date_of_birth;
                        delete member.israeli_id;
                        delete member.address;
                        delete member.extra_phone;
                        delete member.facebook_id;
                        delete member.facebook_token;
                        delete member.addinfo_json;
                        return member;
                    });
                }

                //check eahc memebr and send to the client the jason info
                for (var i in members) {
                    if (members[i].camps_members_addinfo_json) {
                        var addinfo_json = JSON.parse(members[i].camps_members_addinfo_json);
                        //check for pre sale ticket info and update the memebr
                        if (addinfo_json.pre_sale_ticket === "true") {
                            members[i].pre_sale_ticket = true;
                        }
                    } else {
                        members[i].pre_sale_ticket = false;
                    }
                }

                result = camp.parsePrototype(req.user);

                if (isCampManager || (result && result.isAdmin)) {
                    res.status(200).json({ members: members, pre_sale_tickets_quota: camp.attributes.pre_sale_tickets_quota });
                } else {
                    res.status(500).json({ error: true, data: { message: 'Permission denied' } });
                }
            }, req)
        }).catch((e) => {
            res.status(500).json({
                error: true,
                data: {
                    message: 'Failed to fetch camp ' + camp.id
                }
            });
        });
    });

    app.get('/my_groups', userRole.isLoggedIn(), (req, res) => {
        req.user.getUserCamps((camps) => {
            let groups = [];
            let group = {};
            let group_props;
            for (let i in camps) {
                group_props = Camp.prototype.__parsePrototype(camps[i].__prototype, req.user);
                if (['approved', 'pending', 'pending_mgr', 'approved_mgr'].indexOf(camps[i].member_status) > -1) {
                    group = {
                        // group_type:'מחנה נושא',
                        group_id: camps[i].id,
                        group_type: req.t(group_props.t_prefix + 'edit.camp'),
                        member_status: camps[i].member_status,
                        member_status_i18n: camps[i].member_status_i18n,
                        camp_desc_i18n: camps[i].camp_name_he,
                        camp_desc_he: camps[i].camp_name_he,
                        camp_name_en: camps[i].camp_name_en,
                        can_view: ['theme_camp'].indexOf(camps[i].__prototype) > -1,
                        can_edit: camps[i].isManager,
                        is_manager_i18n: camps[i].isManager ? req.t('camps:yes') : req.t('camps:no'),
                    };
                    groups.push(group);
                }
            }
            if (req.user.isAdmin) {
                let query = "SELECT camps.__prototype, SUM(IF(camp_members.status IN ('approved','approved_mgr'),1,0)) AS total FROM camps LEFT JOIN camp_members ON camps.id=camp_members.camp_id WHERE camps.event_id='" + req.user.currentEventId + "' GROUP BY __prototype;";
                let query1 = "SELECT " +
                    "count(*) AS total_tickets" +
                    ",SUM(inside_event) AS inside_event " +
                    ",SUM( IF(first_entrance_timestamp>='2017-01-01%',1,0)) AS ticketing " +
                    ",SUM( IF(first_entrance_timestamp>=NOW() - INTERVAL 1 DAY,1,0)) AS last_24h_first_entrance " +
                    ",SUM( IF(first_entrance_timestamp>=NOW() - INTERVAL 1 HOUR,1,0)) AS last_1h_first_entrance " +
                    ",SUM( IF(entrance_timestamp>=NOW() - INTERVAL 1 DAY,1,0)) AS last_24h_entrance " +
                    ",SUM( IF(last_exit_timestamp>=NOW() - INTERVAL 1 DAY,1,0)) AS last_24h_exit " +
                    ",SUM( IF(entrance_timestamp>=NOW() - INTERVAL 1 HOUR,1,0)) AS last_1h_entrance " +
                    ",SUM( IF(last_exit_timestamp>=NOW() - INTERVAL 1 HOUR,1,0)) AS last_1h_exit " +
                    "FROM tickets  " +
                    "WHERE tickets.event_id='" + req.user.currentEventId +
                    "' GROUP BY event_id; ";
                if (req.user.isAdmin) {
                    let stat = {};
                    knex.raw(query).then((result) => {
                        stat.groups = {};
                        for (let i in result[0]) {
                            stat.groups[result[0][i]['__prototype']] = {
                                total: result[0][i].total
                            };
                        }
                        // stat.total_tickets = result[0][0]['total_tickets'];
                        // stat.inside_event = result[0][0]['inside_event'];
                        // stat.ticketing = result[0][0]['ticketing'];
                        // stat.last_24h_first_entrance = result[0][0]['last_24h_first_entrance'];
                        // stat.last_1h_first_entrance = result[0][0]['last_1h_first_entrance'];
                        // stat.last_24h_entrance = result[0][0]['last_24h_entrance'];
                    }).then(() => {
                        knex.raw(query1).then((result) => {
                            stat.total_tickets = result[0][0]['total_tickets'];
                            stat.inside_event = result[0][0]['inside_event'];
                            stat.ticketing = result[0][0]['ticketing'];
                            stat.last_24h_first_entrance = result[0][0]['last_24h_first_entrance'];
                            stat.last_1h_first_entrance = result[0][0]['last_1h_first_entrance'];
                            stat.last_24h_entrance = result[0][0]['last_24h_entrance'];
                            stat.last_24h_exit = result[0][0]['last_24h_exit'];
                            stat.last_1h_entrance = result[0][0]['last_1h_entrance'];
                            stat.last_1h_exit = result[0][0]['last_1h_exit'];
                            res.status(200).json({ groups: groups, stats: stat });

                        });
                    });
                }
            } else {
                res.status(200).json({ groups: groups });
            }
        }, req, 'all');
    });

    /**
    * API: (POST) camp manager send member join request
    * request => /camps/1/members/add
    */
    app.post('/camps/:id/members/add', userRole.isLoggedIn(), (req, res) => {
        var user_email = req.body.user_email;
        var camp_id = req.params.id;
        if (!common.validateEmail(user_email)) {
            res.status(500).json({ error: true, data: { message: 'Bad email entered!' } });
            return;
        }
        Camp.forge({ id: camp_id }).fetch().then((camp) => {
            if (!camp) {
                res.status(404).end();
                return;
            }
            req.user.getUserCamps((camps) => {
                // let group_props = camp.parsePrototype(req.user);
                let group_props = camp.parsePrototype(req.user);
                if (req.user.isManagerOfCamp(camp_id) || group_props.isAdmin) {
                    User.forge({ email: user_email }).fetch().then((user) => {
                        if (user !== null) {
                            //this user is not the one is logged in, so the current event Id does not exixts
                            //we need to add it from the logged user so getUserCamps will know what to search for
                            user.currentEventId = req.user.currentEventId
                            // check that user is only at one camp!
                            user.getUserCamps((camps) => {
                                if (camps.length === 0 || !user.attributes.camp || group_props.multiple_groups_for_user) {
                                    __camps_update_status(req.user.currentEventId, camp_id, user.attributes.user_id, 'request_mgr', req.user, res);
                                } else {
                                    let message;
                                    if (user.isUserInCamp(camp_id)) {
                                        message = 'Already applied to this camp';
                                    } else {
                                        message = 'Already applied to different camp!';
                                    }
                                    res.status(500).json({ error: true, data: { message: message } });
                                }
                            }, null, camp.attributes.__prototype);
                        } else {
                            if (constants.prototype_camps.by_prototype(camp.attributes.__prototype).allow_new_users) {
                                User.forge().save({
                                    updated_at: (new Date()).toISOString().substring(0, 19).replace('T', ' '),
                                    created_at: (new Date()).toISOString().substring(0, 19).replace('T', ' '),
                                    email: user_email
                                }).then((user) => {
                                    __camps_update_status(req.user.currentEventId, camp_id, user.attributes.user_id, 'request_mgr', req.user, res);
                                });
                            } else {
                                res.status(500).json({ error: true, data: { message: 'Cannot add new emails without profile.' } });
                            }

                        }
                    });

                } else {
                    res.status(404).end();
                }
            }, req, camp.attributes.__prototype);
        });
    })

    /**
    * API: (GET) return camp manager email
    * query user with attribute: camp_id
    * request => /camps/1/camp_manager
    */
    app.get('/camps/:id/manager', userRole.isLoggedIn(), (req, res) => {
        User.forge({ camp_id: req.params.id })
            .fetch({
                require: true,
                columns: ['email', 'roles']
            })
            .then((user) => {
                if (user.get('roles').indexOf('camp_manager')) {
                    res.status(200).json({ user: { email: user.get('email') } })
                } else {
                    res.status(404).json({ data: { message: 'Not found' } })
                }
            }).catch((e) => {
                res.status(500).json({
                    error: true,
                    data: {
                        message: e.message
                    }
                });
            });
    })

    // Delete, make camp inactive
    app.post('/camps/:id/remove', userRole.isAdmin(), (req, res) => {
        Camp.forge({ id: req.params.id })
            .fetch().then((camp) => {
                camp.save({ status: 'inactive' }).then(() => {
                    res.status(200).end()
                }).catch((err) => {
                    res.status(500).json({
                        error: true,
                        data: {
                            message: err.message
                        }
                    });
                });
            });
    })

    // Delete, make camp inactive
    app.post('/camps/:id/updatePreSaleQuota', userRole.isAdmin(), (req, res) => {
        Camp.forge({ id: req.params.id })
            .fetch().then((camp) => {
                var quota = req.body.quota;
                if (common.isNormalInteger(quota) === false) {
                    return res.status(500).json({
                        error: true,
                        data: {
                            message: "Quota must be in a number format"
                        }
                    });
                }

                camp.save({ pre_sale_tickets_quota: quota }).then(() => {
                    res.status(200).end()
                }).catch((err) => {
                    res.status(500).json({
                        error: true,
                        data: {
                            message: err.message
                        }
                    });
                });
            });
    })

}