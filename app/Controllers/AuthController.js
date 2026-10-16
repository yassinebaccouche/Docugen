import {
  GoogleAuthProvider,
  sendPasswordResetEmail,
  signInWithPopup,
  signOut,
} from "firebase/auth";
import { auth } from "../Firebase/Config";
import User from "../Services/User";


class AuthController {
  static async handleSignup(email, password, profile = {}) {
    const user = new User(email, password, profile);
    return user.signup();
  }

  static async handleLogin(email, password) {
    const user = new User(email, password);
    return user.login();
  }

  static async handleGoogleLogin() {
    const credentials = await signInWithPopup(auth, new GoogleAuthProvider());
    return User.saveProfile(credentials.user, {
      name: credentials.user.displayName,
      profilePic: credentials.user.photoURL,
    });
  }

  static async getProfile(firebaseUser) {
    return User.getProfile(firebaseUser);
  }

  static async handleLogout() {
    await signOut(auth);
  }

  static async handleForgotPassword(email) {
    await sendPasswordResetEmail(auth, email);
  }
}

export default AuthController;
