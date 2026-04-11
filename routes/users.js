const express = require('express');
const router = express.Router();
const { getUsers, createUser, getUser, updateUser, deleteUser, resetPassword } = require('../controllers/userController');
const { protect, departmentScope } = require('../middleware/auth');

router.use(protect, departmentScope);

router.get('/', getUsers);
router.post('/', createUser);
router.get('/:id', getUser);
router.put('/:id', updateUser);
router.delete('/:id', deleteUser);
router.put('/:id/reset-password', resetPassword);

module.exports = router;
