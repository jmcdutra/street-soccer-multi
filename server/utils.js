const { customAlphabet } = require('nanoid');
const alphabet = '0123456789abcdefghjkmnopqrstuvwxyz';
const nanoid = (length)=>customAlphabet(alphabet,length)();
const {UserModel,VisitModel} = require('./User.js');
const MAX_VISITS_PER_AGENT = 25;

function isSecureRequest(req) {
    if (req.secure) return true;
    if (req.headers['x-forwarded-proto'] === 'https') return true;
    return process.env.COOKIE_SECURE === '1';
}

function getCookieOptions(req) {
    return {
        httpOnly: true,
        sameSite: 'lax',
        secure: isSecureRequest(req),
        maxAge: 365 * 24 * 60 * 60 * 1000
    };
}

function getClientIp(req) {
    const forwarded = req.headers['x-forwarded-for'];
    if (typeof forwarded === 'string' && forwarded.length) {
        return forwarded.split(',')[0].trim();
    }
    return req.socket.remoteAddress;
}

async function logiphelper(req,res,uid){
    // fs.writeFile("./logs/log.txt",JSON.stringify(req.headers,null,2),{flag:'w+'},err=>{});
    try{
        let client_ip = getClientIp(req);
        let useragent = req.headers['user-agent'] ?? "";
        if(/bot|crawl|slurp|spider|mediapartners/.test(useragent.toLowerCase())){
            uid = "BOTS";
        }
        let referer = req.headers["referer"] ?? "null";
        let user=null;
        user = await UserModel.findOne({uid:uid}).exec();
        if(!user) user = UserModel({uid:uid});
        // console.log(`uid=${uid}`);
        req.uid = uid;
        user.recentIp = client_ip;
        user.uniqueIps = Array.isArray(user.uniqueIps) ? user.uniqueIps : [];
        if(user.uniqueIps.indexOf(client_ip) === -1) user.uniqueIps.push(client_ip);
        let dateIST = new Date(new Date().getTime() + (new Date().getTimezoneOffset() + 330)*60000);
        // dateIST = dateIST.toString();
        let visit = {ip:client_ip,route:req.originalUrl,referer:referer,dateTime:dateIST};
        // console.log("first",user.visits);
        user.visits[useragent] = user.visits[useragent] ?? [];
        user.visits[useragent].push(visit);
        if(user.visits[useragent].length > MAX_VISITS_PER_AGENT){
            user.visits[useragent] = user.visits[useragent].slice(-MAX_VISITS_PER_AGENT);
        }
        // console.log("second",user.visits);
        // very important
        user.markModified('visits');
        await user.save();
    }catch(err){
        console.log("Error mongodb UID",err);
    }
}
async function logip(req,res){
    let uid = req.cookies["uid"];
    if(!uid) {
        uid = nanoid(6);
        res.cookie('uid', `${uid}`, getCookieOptions(req));
    }
    req.uid = uid;
    return logiphelper(req,res,uid);
}
module.exports = {
    nanoid,
    logip
}
