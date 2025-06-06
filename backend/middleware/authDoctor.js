import jwt from 'jsonwebtoken'

const authDoctor = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader) {
      return res.json({ success: false, message: "Not Authorized. Login Again" });
    }

    const token = authHeader.startsWith("Bearer ") ? authHeader.split(" ")[1] : authHeader;

    const token_decode = jwt.verify(token, process.env.JWT_SECRET);
    req.docId = token_decode.id; // ✅ fix here
    next();

  } catch (error) {
    console.log(error);
    res.json({ success: false, message: error.message });
  }
};

export default authDoctor;
