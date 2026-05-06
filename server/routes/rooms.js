const express = require('express');
const { Game } = require('../game');
const { nanoid,logip } = require('../utils');

const router = express.Router();


router.get('/create', (req,res)=>{
    res.redirect('/play');
})
router.get('/allrooms',(req,res)=>{
    res.json({ arena: Object.keys(global.arena?.players ?? {}).length });
})
router.get('/',(req,res)=>{
    res.redirect('/');
})
router.get('/:roomName', async (req,res)=>{
    res.redirect('/play');
})


module.exports = router
