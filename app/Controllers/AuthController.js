import {
  GoogleAuthProvider,
  sendPasswordResetEmail,
  signInWithPopup,
  signOut,
} from "firebase/auth";
import { auth } from "../Firebase/Config";
import User from "../Services/User";


class AuthController {
  static getGoogleSignInErrorMessage(error) {
    const code =
      error && typeof error === "object" && "code" in error
        ? error.code
        : null;

    switch (code) {
      case "auth/unauthorized-domain":
        return "Ce domaine n’est pas autorisé par Firebase. Ajoutez le domaine actuel dans Firebase Console > Authentication > Settings > Authorized domains.";
      case "auth/operation-not-allowed":
        return "La connexion Google n’est pas activée. Activez le fournisseur Google dans Firebase Console > Authentication > Sign-in method.";
      case "auth/popup-blocked":
        return "La fenêtre Google a été bloquée par le navigateur. Autorisez les fenêtres pop-up pour ce site, puis réessayez.";
      case "auth/popup-closed-by-user":
        return "La fenêtre de connexion Google a été fermée avant la fin de la connexion.";
      case "auth/cancelled-popup-request":
        return "Une autre fenêtre de connexion est déjà ouverte. Fermez-la et réessayez.";
      case "auth/network-request-failed":
        return "Connexion impossible au service Google. Vérifiez votre connexion Internet et réessayez.";
      case "auth/invalid-api-key":
        return "La configuration Firebase de cette application est invalide. Vérifiez la clé API du projet.";
      case "permission-denied":
      case "firestore/permission-denied":
        return "La connexion Google a réussi, mais Firestore a refusé l’enregistrement du profil. Vérifiez les règles Firestore déployées.";
      default:
        return error instanceof Error
          ? `Connexion Google impossible : ${error.message}`
          : "Connexion Google impossible. Vérifiez les paramètres Firebase Authentication et réessayez.";
    }
  }

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
