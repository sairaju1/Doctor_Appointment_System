import validator from 'validator'
import bcrypt from 'bcrypt'
import userModel from '../models/userModel.js'
import jwt from 'jsonwebtoken'
import { v2 as cloudinary } from 'cloudinary'
import doctorModel from '../models/doctorModel.js'
import appointmentModel from '../models/appointmentModel.js'
import razorpay from 'razorpay'

//API to register user
const registerUser = async (req, res) => {

  try {

    const { name, email, password } = req.body

    if (!name || !password || !email) {
      return res.json({ success: false, message: "Missing Details" })
    }

    //validating email format
    if (!validator.isEmail(email)) {
      return res.json({ success: false, message: "enter a valid email" })

    }

    //validating strong password
    if (password.length < 8) {
      return res.json({ success: false, message: "enter a strong password" })

    }

    //hasing user password
    const salt = await bcrypt.genSalt(10)
    const hashedPassword = await bcrypt.hash(password, salt)

    const userData = {
      name,
      email,
      password: hashedPassword
    }

    const newUser = new userModel(userData)
    const user = await newUser.save()

    const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET)

    res.json({ success: true, token })


  } catch (error) {

    console.log(error)
    res.json({ success: false, message: error.message })

  }
}

//API for user login
const loginUser = async (req, res) => {

  try {

    const { email, password } = req.body
    const user = await userModel.findOne({ email })

    if (!user) {
      return res.json({ success: false, message: 'User does not exist' })

    }

    const isMatch = await bcrypt.compare(password, user.password)

    if (isMatch) {
      const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET)
      res.json({ success: true, token })
    }
    else {
      res.json({ success: false, message: "Invalid credentials" })
    }

  } catch (error) {
    console.log(error)
    res.json({ success: false, message: error.message })
  }
}

//API to get user profile data
const getProfile = async (req, res) => {
  try {
    const userId = req.user.id;
    const user = await userModel.findById(userId);

    if (!user) {
      return res.json({ success: false, message: "User not found" });
    }

    res.json({ success: true, user });
  } catch (error) {
    console.log(error);
    res.json({ success: false, message: error.message });
  }
};


//API to update user profile
const updateProfile = async (req, res) => {
  try {
    const userId = req.user.id; // get from JWT, via middleware
    const { name, phone, address, dob, gender } = req.body;
    const imageFile = req.file;

    if (!name || !phone || !dob || !gender) {
      return res.json({ success: false, message: "Data Missing" });
    }

    const updateData = {
      name,
      phone,
      address: JSON.parse(address),
      dob,
      gender
    };

    // Update text fields
    await userModel.findByIdAndUpdate(userId, updateData);

    // Update image if provided
    if (imageFile) {
      const imageUpload = await cloudinary.uploader.upload(imageFile.path, { resource_type: 'image' });
      const imageURL = imageUpload.secure_url;
      await userModel.findByIdAndUpdate(userId, { image: imageURL });
    }

    res.json({ success: true, message: "Profile Updated" });

  } catch (error) {
    console.log(error);
    res.json({ success: false, message: error.message });
  }
};

//API to book appointment
// API to book appointment
const bookAppointmnet = async (req, res) => {
  try {
    const userId = req.user.id; // from middleware
    const { docId, slotDate, slotTime } = req.body;

    if (!userId || !docId || !slotDate || !slotTime) {
      return res.status(400).json({ success: false, message: "Missing required fields" });
    }

    // Check if slot is already booked
    const isBooked = await appointmentModel.findOne({
      docId,
      slotDate,
      slotTime,
      cancelled: false
    });

    if (isBooked) {
      return res.json({ success: false, message: "Slot Already Booked" });
    }

    // Fetch doctor and user data
    const docData = await doctorModel.findById(docId).select('-password');
    const userData = await userModel.findById(userId).select('-password');

    if (!docData || !userData) {
      return res.json({ success: false, message: 'Doctor or User not found' });
    }

    // ❗️ Check doctor availability
    if (!docData.available) {
      return res.json({ success: false, message: 'Doctor is not available currently' });
    }

    const plainDocData = docData.toObject();
    const plainUserData = userData.toObject();

    delete plainDocData.slots_booked;

    const appointmentData = {
      userId,
      docId,
      userData: plainUserData,
      docData: plainDocData,
      amount: docData.fees,
      slotTime,
      slotDate,
      date: Date.now()
    };

    const newAppoint = new appointmentModel(appointmentData);
    await newAppoint.save();

    return res.status(200).json({
      success: true,
      message: "Appointment Booked Successfully",
      data: newAppoint
    });

  } catch (error) {
    console.error("Error in bookAppointmnet:", error);
    return res.status(500).json({
      success: false,
      message: "Error While Booking Appointment",
      error: error.message
    });
  }
};



//API to get user appointments for frontend my-appointments page
const listAppointment = async (req, res) => {
  try {
    const userId = req.user.id;  // <-- get userId from req.user, not req.body

    if (!userId) {
      return res.status(400).json({ success: false, message: "User ID not found" });
    }

    const appointments = await appointmentModel.find({ userId });

    res.json({ success: true, appointments });

  } catch (error) {
    console.log(error);
    res.json({ success: false, message: error.message });
  }
};

//API to cancel appointment
const cancelAppointment = async (req, res) => {
  try {
    const userId = req.user.id; // From JWT middleware
    const { appointmentId } = req.body;

    const appointmentData = await appointmentModel.findById(appointmentId);

    if (!appointmentData) {
      return res.json({ success: false, message: 'Appointment not found' });
    }

    if (appointmentData.userId.toString() !== userId.toString()) {
      return res.json({ success: false, message: 'Unauthorized action' });
    }

    await appointmentModel.findByIdAndUpdate(appointmentId, { cancelled: true });

    // release doctor slot
    const { docId, slotDate, slotTime } = appointmentData;
    const doctorData = await doctorModel.findById(docId);
    let slots_booked = doctorData.slots_booked;

    if (slots_booked[slotDate]) {
      slots_booked[slotDate] = slots_booked[slotDate].filter(e => e !== slotTime);
    }

    await doctorModel.findByIdAndUpdate(docId, { slots_booked });

    res.json({ success: true, message: 'Appointment Cancelled' });

  } catch (error) {
    console.log(error);
    res.json({ success: false, message: error.message });
  }
};

const razorpayInstance = new razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
})

//API to make payment of appointment using razorpay
const paymentRazorpay = async (req, res) => {
  try {
    const { appointmentId } = req.body;

    const appointmentData = await appointmentModel.findById(appointmentId);

    if (!appointmentData || appointmentData.cancelled) {
      return res.json({ success: false, message: "Appointment not found or Cancelled" });
    }

    const options = {
      amount: appointmentData.amount * 100,
      currency: process.env.CURRENCY,
      receipt: appointmentId,
    };

    const order = await razorpayInstance.orders.create(options);
    res.json({ success: true, order });

  } catch (error) {
    console.log(error);
    res.json({ success: false, message: error.message });
  }
};

//API to verify payment of razorpay
const verifyRazorpay=async(req,res)=>{

  try{

    const {razorpay_order_id} = req.body
    const orderInfo = await razorpayInstance.orders.fetch(razorpay_order_id)

    //console.log(orderInfo)
    if(orderInfo.status === 'paid'){
        await appointmentModel.findByIdAndUpdate(orderInfo.receipt,{payment:true})
        res.json({success:true,message:"Payment Successful"})
    }
    else{
        res.json({success:false,message:"Payment failed"})

    }


  }catch(error){
    console.log(error);
    res.json({ success: false, message: error.message });

  }
}







export { registerUser, loginUser, getProfile, updateProfile, bookAppointmnet, listAppointment, cancelAppointment,paymentRazorpay,verifyRazorpay, }
