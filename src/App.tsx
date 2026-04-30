import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Search, Home, Calendar, MessageCircle, User, Star, MapPin, CheckCircle, ShieldAlert, Flag, TrendingUp, Users, ChevronRight, X, Image as ImageIcon, Send, Clock, Edit2, AlertTriangle, ShieldCheck, Mic, Square, Play, Eye, EyeOff } from 'lucide-react';
import { auth, db } from './firebase';
import { signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut, onAuthStateChanged, sendPasswordResetEmail, sendEmailVerification } from 'firebase/auth';
import { doc, getDoc, setDoc, updateDoc, collection, query, where, or, addDoc, onSnapshot, deleteDoc } from 'firebase/firestore';
import { handleFirestoreError, OperationType } from './firestoreUtils';
import { LocationAutocomplete } from './components/LocationAutocomplete';


// --- MOCK DATA & TYPES ---

type Role = 'user' | 'vendor' | 'admin';

interface UserProfile {
  id: string;
  role: Role;
  name: string;
  email?: string;
  phone?: string;
  location?: string;
  profilePic?: string;
  isCompleted?: boolean;
  isRedFlagged?: boolean;
  isBlocked?: boolean;
  // Vendor specific
  locations?: string[];
  description?: string;
  instagram?: string;
  images?: string[];
  portfolio?: string[];
  rating?: number;
  services?: string[];
  verificationStatus?: 'none' | 'pending' | 'approved' | 'rejected';
}

interface Message {
  id: string;
  senderId: string;
  receiverId: string;
  text: string;
  timestamp: number;
  hasImage?: boolean;
  imageUrl?: string;
  isAudio?: boolean;
  audioDuration?: number;
}

interface Booking {
  id: string;
  userId: string;
  vendorId?: string;
  type: string;
  package: string;
  location: string;
  date: string;
  people: string;
  status: 'pending' | 'confirmed' | 'completed' | 'rejected';
  isReviewed?: boolean;
}

interface Review {
  id: string;
  bookingId: string;
  vendorId: string;
  userId: string;
  rating: number;
  comment: string;
  reply?: string;
  timestamp: number;
}

const MOCK_VENDORS: UserProfile[] = [
  { id: 'v1', role: 'vendor', name: 'Elite Events', locations: ['New York', 'Brooklyn'], description: 'Premium wedding setups.', rating: 4.8, isCompleted: true, profilePic: 'https://i.pravatar.cc/150?u=v1' },
  { id: 'v2', role: 'vendor', name: 'Party Perfect', locations: ['Queens', 'New York'], description: 'Birthday and anniversary experts.', rating: 4.5, isCompleted: true, profilePic: 'https://i.pravatar.cc/150?u=v2' },
];

export default function App() {
  const [pendingOAuthUser, setPendingOAuthUser] = useState<any | null>(null);
  const [currentUser, setCurrentUser] = useState<UserProfile | null>(null);
  const [view, setView] = useState<'auth' | 'home' | 'booking' | 'vendor_profile' | 'user_profile' | 'messages' | 'admin' | 'activity' | 'public_vendor' | 'vendor_reviews'>('auth');
  const [authLoading, setAuthLoading] = useState(true);
  
  // Navigation State
  const [activeTab, setActiveTab] = useState<'home' | 'bookings' | 'messages' | 'account' | 'reviews'>('home');
  const [selectedVendorId, setSelectedVendorId] = useState<string | null>(null);
  const [activeChatId, setActiveChatId] = useState<string | null>(null);
  
  // DB State
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [chats, setChats] = useState<Message[]>([]);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [reviews, setReviews] = useState<Review[]>([]);

  useEffect(() => {
    const unsubAuth = onAuthStateChanged(auth, async (user) => {
      if (user) {
        if (user.email === 'admin@hitshigh.com') {
          setCurrentUser({ id: user.uid, role: 'admin', name: 'Super Admin', email: user.email, isCompleted: true });
          setView('admin');
          setAuthLoading(false);
        } else {
          try {
            const docRef = doc(db, 'users', user.uid);
            const docSnap = await getDoc(docRef);
            if (docSnap.exists()) {
              const userData = docSnap.data() as UserProfile;
              if (userData.isBlocked) {
                alert("Your account has been blocked.");
                await signOut(auth);
                setCurrentUser(null);
                setView('auth');
              } else {
                setCurrentUser(userData);
                setPendingOAuthUser(null);
                // Redirect vendor to activity dashboard automatically if they are completed
                if (userData.role === 'vendor') {
                  if (!userData.isCompleted) {
                    setView('vendor_profile');
                    setActiveTab('account');
                  } else {
                    setView('activity');
                    setActiveTab('bookings');
                  }
                } else {
                  setView('home');
                }
              }
            } else {
              // New user from OAuth, ask for role
              setPendingOAuthUser(user);
              setView('auth');
            }
          } catch(e: any) {
            alert("Auth DB error: " + e.message);
            await signOut(auth);
            setCurrentUser(null);
            setView('auth');
          } finally {
            setAuthLoading(false);
          }
        }
      } else {
        setCurrentUser(null);
        setView('auth');
        setAuthLoading(false);
      }
    });
    return () => unsubAuth();
  }, []);

  useEffect(() => {
    if (!currentUser) return;
    
    // Subscribe to all users (for admin and discovering vendors)
    const unsubUsers = onSnapshot(collection(db, 'users'), (snapshot) => {
      const u: UserProfile[] = [];
      snapshot.forEach(doc => {
         u.push(doc.data() as UserProfile);
      });
      setUsers(u);
    }, (error) => handleFirestoreError(error, OperationType.LIST, 'users'));

    // Subscribe to bookings
    let bookingsQuery;
    if (currentUser.role === 'admin') {
      bookingsQuery = query(collection(db, 'bookings'));
    } else if (currentUser.role === 'vendor') {
      bookingsQuery = query(collection(db, 'bookings'), where('vendorId', '==', currentUser.id));
    } else {
      bookingsQuery = query(collection(db, 'bookings'), where('userId', '==', currentUser.id));
    }
    const unsubBookings = onSnapshot(bookingsQuery, (snapshot) => {
      const b: Booking[] = [];
      snapshot.forEach(doc => {
         b.push(doc.data() as Booking);
      });
      setBookings(b);
    }, (error) => handleFirestoreError(error, OperationType.LIST, 'bookings'));

    // Subscribe to reviews
    let reviewsQuery = query(collection(db, 'reviews')); // fetch all for simplicity or filter by relevant users
    if (currentUser.role === 'vendor') {
      reviewsQuery = query(collection(db, 'reviews'), where('vendorId', '==', currentUser.id));
    } else if (currentUser.role === 'user') {
      reviewsQuery = query(collection(db, 'reviews'), where('userId', '==', currentUser.id));
    }
    const unsubReviews = onSnapshot(reviewsQuery, (snapshot) => {
      const r: Review[] = [];
      snapshot.forEach(doc => r.push(doc.data() as Review));
      setReviews(r);
    }, (error) => handleFirestoreError(error, OperationType.LIST, 'reviews'));

    // Subscribe to chats
    let chatsQuery;
    if (currentUser.role === 'admin') {
      chatsQuery = query(collection(db, 'chats'));
    } else {
      chatsQuery = query(collection(db, 'chats'), or(where('senderId', '==', currentUser.id), where('receiverId', '==', currentUser.id)));
    }
    const unsubChats = onSnapshot(chatsQuery, (snapshot) => {
      const c: Message[] = [];
      snapshot.forEach(doc => {
         c.push(doc.data() as Message);
      });
      // Sort by timestamp asc
      setChats(c.sort((a,b) => a.timestamp - b.timestamp));
    }, (error) => handleFirestoreError(error, OperationType.LIST, 'chats'));

    return () => {
      unsubUsers();
      unsubBookings();
      unsubChats();
      unsubReviews();
    }
  }, [currentUser]);
  const handleNav = (tab: 'home' | 'bookings' | 'messages' | 'account' | 'reviews') => {
    setActiveTab(tab);
    if (tab === 'home') setView('home');
    if (tab === 'account') {
      if (currentUser?.role === 'vendor') setView('vendor_profile');
      if (currentUser?.role === 'user') setView('user_profile');
    }
    if (tab === 'messages') {
      setActiveChatId(null);
      setView('messages');
    }
    if (tab === 'bookings') setView('activity');
    if (tab === 'reviews') setView('vendor_reviews');
  };

  const login = (user: UserProfile) => {
    // Already handled by auth state listener
  };

  const logout = async () => {
    await signOut(auth);
  };

  if (authLoading) {
    return <div className="bg-gray-950 min-h-screen flex items-center justify-center text-teal-500">Loading...</div>;
  }

  return (
    <div className="bg-gray-950 min-h-screen text-gray-100 font-sans selection:bg-teal-500/30 overflow-x-hidden relative">
      <div className="fixed inset-0 pointer-events-none z-0">
        <div className="absolute inset-0 bg-gradient-to-b from-gray-950 via-[#0a1f18] to-gray-950 opacity-90"></div>
        <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-teal-900/20 rounded-full blur-[120px]"></div>
        <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-[#0f3d32]/30 rounded-full blur-[100px]"></div>
      </div>

      <div className="relative z-10 h-full flex flex-col min-h-screen">
        <AnimatePresence mode="wait">
          {view === 'auth' && <motion.div key="auth" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}><AuthScreen onLogin={login} setUsers={setUsers} users={users} pendingOAuthUser={pendingOAuthUser} onCancelPending={() => { setPendingOAuthUser(null); signOut(auth); setView('auth'); }} /></motion.div>}
          {view === 'home' && <motion.div key="home" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}><HomeScreen currentUser={currentUser} onStartBooking={() => setView('booking')} vendors={users.filter(u => u.role === 'vendor' && u.isCompleted)} onVendorSelect={(id) => { setSelectedVendorId(id); setView('public_vendor'); }} onUpdateLocation={async (location) => {
            if (currentUser) {
               try {
                  await updateDoc(doc(db, 'users', currentUser.id), { location });
                  setCurrentUser({ ...currentUser, location });
               } catch (e: any) { alert("Failed to update location: " + e.message); }
            }
          }} /></motion.div>}
          {view === 'booking' && <motion.div key="booking" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}><BookingFlow vendor={selectedVendorId ? users.find(u => u.id === selectedVendorId) : null} onComplete={async (b) => { 
            try {
              const newBooking = { ...b, userId: currentUser?.id || 'unknown' };
              await setDoc(doc(db, 'bookings', b.id), newBooking);
              setActiveTab('bookings'); setView('activity'); 
            } catch(e: any) { alert(e.message); }
          }} onCancel={() => setView('home')} /></motion.div>}
          {view === 'activity' && <motion.div key="activity" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}><ActivityScreen currentUser={currentUser} bookings={bookings} reviews={reviews} users={users} onVendorSelect={(id) => { setSelectedVendorId(id); setView('public_vendor'); }} onMessage={(id) => { setActiveChatId(id); setActiveTab('messages'); setView('messages'); }} onUpdateBooking={async (id, updates) => {
            try { await updateDoc(doc(db, 'bookings', id), updates); } catch(e: any) { alert("Failed to update booking: " + e.message); }
          }} onAddReview={async (r) => {
            try { await setDoc(doc(db, 'reviews', r.id), r); await updateDoc(doc(db, 'bookings', r.bookingId), { isReviewed: true }); } catch(e: any) { alert("Failed to leave review: " + e.message); }
          }} /></motion.div>}
          {view === 'public_vendor' && <motion.div key="public_vendor" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}><PublicVendorProfile vendorId={selectedVendorId} users={users} reviews={reviews} onBack={() => setView('home')} onMessage={(id) => { setActiveChatId(id); setActiveTab('messages'); setView('messages'); }} onBook={() => setView('booking')} /></motion.div>}
          {view === 'vendor_reviews' && <motion.div key="vendor_reviews" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}><VendorReviewsScreen vendor={currentUser!} reviews={reviews} users={users} onReply={async (reviewId, reply) => {
            try { await updateDoc(doc(db, 'reviews', reviewId), { reply }); } catch(e: any) { alert("Failed to reply: " + e.message); }
          }} /></motion.div>}
          {view === 'vendor_profile' && <motion.div key="vendor_profile" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}><VendorProfile user={currentUser} onUpdate={async (u) => {
            try {
              if (currentUser) {
                const safeUpdate: any = {};
                ['name', 'phone', 'description', 'instagram', 'locations', 'portfolio', 'profilePic', 'isCompleted', 'services', 'verificationStatus'].forEach(k => { 
                  if (u[k as keyof UserProfile] !== undefined) safeUpdate[k] = u[k as keyof UserProfile]; 
                });
                await updateDoc(doc(db, 'users', currentUser.id), safeUpdate);
              }
              setCurrentUser({...currentUser, ...u} as UserProfile);
            } catch(e: any) { alert("Failed to save profile: " + e.message); }
          }} onLogout={logout} /></motion.div>}
          {view === 'user_profile' && <motion.div key="user_profile" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}><UserProfileScreen user={currentUser} onUpdate={async (u) => {
            try {
              if (currentUser) {
                const safeUpdate: any = {};
                ['name', 'phone', 'location', 'profilePic', 'isCompleted'].forEach(k => { 
                  if (u[k as keyof UserProfile] !== undefined) safeUpdate[k] = u[k as keyof UserProfile]; 
                });
                await updateDoc(doc(db, 'users', currentUser.id), safeUpdate);
              }
              setCurrentUser({...currentUser, ...u} as UserProfile);
            } catch(e: any) { alert("Failed to save profile: " + e.message); }
          }} onLogout={logout} /></motion.div>}
          {view === 'messages' && <motion.div key="messages" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}><MessagesScreen currentUser={currentUser} users={users} chats={chats} activeChatId={activeChatId} setActiveChatId={setActiveChatId} onSendMessage={async (m) => {
            try {
              await setDoc(doc(db, 'chats', m.id), m);
            } catch(e) { handleFirestoreError(e, OperationType.CREATE, 'chats'); }
          }} onBook={(vendorId) => { setSelectedVendorId(vendorId); setView('booking'); }} /></motion.div>}
          {view === 'admin' && <motion.div key="admin" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}><AdminDashboard users={users} bookings={bookings} chats={chats} onLogout={logout} onUpdateUser={async (id, updates) => {
            try { await updateDoc(doc(db, 'users', id), updates); } catch(e) { handleFirestoreError(e, OperationType.UPDATE, 'users'); }
          }} onDeleteUser={async (id) => {
            try { await deleteDoc(doc(db, 'users', id)); } catch(e: any) { alert("Failed to delete user: " + e.message); }
          }} onAddUser={async (email, phone, pass, role) => {
             try {
                const { initializeApp } = await import('firebase/app');
                const { getAuth, createUserWithEmailAndPassword } = await import('firebase/auth');
                const firebaseConfig = (await import('../firebase-applet-config.json')).default;
                const secondaryApp = initializeApp(firebaseConfig, "SecondaryApp" + Date.now());
                const secondaryAuth = getAuth(secondaryApp);
                const ident = email || `${phone.replace(/[^0-9+]/g, '')}@phone.hitshigh.com`;
                const result = await createUserWithEmailAndPassword(secondaryAuth, ident, pass);
                await setDoc(doc(db, 'users', result.user.uid), {
                  id: result.user.uid, role, name: 'New ' + (role.charAt(0).toUpperCase() + role.slice(1)), email, phone, isCompleted: !!phone, isBlocked: false, isRedFlagged: false
                });
                await secondaryAuth.signOut();
             } catch(e: any) {
               alert("Failed to add user: " + e.message);
             }
          }} /></motion.div>}
        </AnimatePresence>
      </div>

      {currentUser && currentUser.role !== 'admin' && view !== 'booking' && (
        <BottomNav role={currentUser.role} activeTab={activeTab} onSelect={handleNav} />
      )}
    </div>
  );
}

// --- COMPONENTS ---

// 1. Auth Screen
function AuthScreen({ onLogin, setUsers, users, pendingOAuthUser, onCancelPending }: { onLogin: (u: UserProfile) => void, setUsers: any, users: UserProfile[], pendingOAuthUser?: any, onCancelPending?: () => void }) {
  const [authMode, setAuthMode] = useState<'login' | 'signup-user' | 'signup-vendor' | 'forgot-password'>('login');
  const [username, setUsername] = useState('');
  const [loginId, setLoginId] = useState('');
  const [phoneSignup, setPhoneSignup] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [oauthRole, setOauthRole] = useState<'user' | 'vendor'>('user');
  const role = authMode === 'signup-vendor' ? 'vendor' : 'user';

  const handleAppleLogin = async () => {
    try {
      const { OAuthProvider, signInWithPopup } = await import('firebase/auth');
      const provider = new OAuthProvider('apple.com');
      await signInWithPopup(auth, provider);
      // document creation moved to pendingOAuthUser flow in App.tsx -> AuthScreen
    } catch(e: any) {
      alert("Apple sign in failed: " + e.message);
    }
  };

  const handleGoogleLogin = async () => {
    try {
      const { GoogleAuthProvider, signInWithPopup } = await import('firebase/auth');
      const provider = new GoogleAuthProvider();
      await signInWithPopup(auth, provider);
      // document creation moved to pendingOAuthUser flow in App.tsx -> AuthScreen
    } catch(e: any) {
      alert("Google sign in failed: " + e.message);
    }
  };

  const handleCompleteOAuth = async () => {
    if (!pendingOAuthUser) return;
    setLoading(true);
    try {
      await setDoc(doc(db, 'users', pendingOAuthUser.uid), {
        id: pendingOAuthUser.uid, 
        role: oauthRole, 
        name: pendingOAuthUser.displayName || 'User', 
        email: pendingOAuthUser.email || '', 
        phone: phoneSignup,
        isCompleted: false, 
        isBlocked: false, 
        isRedFlagged: false
      });
      // the App.tsx onAuthStateChanged listener might not re-fire if auth state hasn't changed,
      // so we should force a reload of the listener or reload the page?
      // Wait, we can just trigger a manual getDoc and then the app state will update
      window.location.reload(); 
    } catch(e: any) {
      alert("Failed to complete setup: " + e.message);
    } finally {
      setLoading(false);
    }
  };

  if (pendingOAuthUser) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen p-6 relative">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="w-full max-w-sm z-10 text-center">
          <div className="w-20 h-20 bg-teal-500 rounded-3xl mx-auto mb-8 flex items-center justify-center shadow-[0_0_40px_rgba(20,184,166,0.3)] rotate-12">
            <CheckCircle className="text-gray-950 w-10 h-10 -rotate-12" />
          </div>
          <h1 className="text-3xl font-extrabold text-white mb-2 tracking-tight">Almost done!</h1>
          <p className="text-gray-400 mb-8 text-sm">Please complete your profile to continue.</p>

          <div className="space-y-4 text-left">
            <div className="space-y-3 bg-gray-900 border border-gray-800 p-4 rounded-xl mb-4">
              <label className="text-xs font-bold text-gray-500 uppercase tracking-widest">I am a...</label>
              <div className="flex flex-col space-y-3">
                <label className="flex items-center space-x-2 text-sm text-gray-300 cursor-pointer">
                  <input type="radio" checked={oauthRole === 'user'} onChange={() => setOauthRole('user')} className="text-teal-500 focus:ring-teal-500 bg-gray-800 border-gray-700" />
                  <span>Client (Looking to book)</span>
                </label>
                <label className="flex items-center space-x-2 text-sm text-gray-300 cursor-pointer">
                  <input type="radio" checked={oauthRole === 'vendor'} onChange={() => setOauthRole('vendor')} className="text-teal-500 focus:ring-teal-500 bg-gray-800 border-gray-700" />
                  <span>Service Provider</span>
                </label>
              </div>
            </div>
            {!pendingOAuthUser.phoneNumber && (
              <input 
                type="tel" placeholder="Phone Number" value={phoneSignup} onChange={e => setPhoneSignup(e.target.value)}
                className="w-full bg-gray-950 border border-gray-800 rounded-xl px-4 py-3 focus:outline-none focus:border-teal-500 transition-colors text-white placeholder-gray-500 text-sm"
              />
            )}
            <button onClick={handleCompleteOAuth} disabled={loading} className="w-full bg-teal-500 text-gray-950 font-bold py-3.5 rounded-xl hover:bg-teal-400 transition-all shadow-[0_0_20px_rgba(20,184,166,0.3)] disabled:opacity-50">
              {loading ? 'Saving...' : 'Complete Sign Up'}
            </button>
            {onCancelPending && (
              <button onClick={onCancelPending} disabled={loading} className="w-full text-gray-500 font-bold py-3.5 rounded-xl hover:text-white transition-all text-sm disabled:opacity-50 mt-2">
                Sign out
              </button>
            )}
          </div>
        </motion.div>
      </div>
    );
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    let authEmail = loginId;

    try {
      if (authMode === 'forgot-password') {
        if (!loginId.includes('@')) {
          alert("Please enter a valid email address.");
          setLoading(false);
          return;
        }
        await sendPasswordResetEmail(auth, loginId);
        alert("Password reset email sent! Check your inbox.");
        setAuthMode('login');
        setLoading(false);
        return;
      } else if (authMode === 'login') {
        if (loginId === 'admin' || loginId === 'admin@hitshigh.com') {
          try {
             await signInWithEmailAndPassword(auth, 'admin@hitshigh.com', password);
          } catch(e) {
             const userCred = await createUserWithEmailAndPassword(auth, 'admin@hitshigh.com', password);
             await setDoc(doc(db, 'users', userCred.user.uid), {
                id: userCred.user.uid, role: 'admin', name: 'Super Admin', email: 'admin@hitshigh.com', isCompleted: true, isBlocked: false, isRedFlagged: false
             });
          }
          return;
        }

        // If phone number is entered instead of email (doesn't contain @)
        // Look up mapping in Firestore (requires adjusting rules, using a workaround for preview)
        if (!loginId.includes('@')) {
           const usersRef = collection(db, 'users');
           const q = query(usersRef, where('phone', '==', loginId));
           // This query will fail if rules deny unauthenticated read, 
           // but we'll try to fetch or construct a pseudo-email if they used phone as email
           try {
             // In a real app we need a custom backend or phone auth, using the phone as email identifier here
             authEmail = `${loginId.replace(/[^0-9+]/g, '')}@phone.hitshigh.com`;
           } catch(e) { 
             console.error(e);
           }
        }

        await signInWithEmailAndPassword(auth, authEmail, password);
      } else if (authMode === 'signup-user' || authMode === 'signup-vendor') {
        if (password !== confirmPassword) {
          alert("Passwords do not match");
          setLoading(false);
          return;
        }
        
        // If they sign up with phone only, use a pseudo email
        if (!loginId.includes('@')) {
           authEmail = `${loginId.replace(/[^0-9+]/g, '')}@phone.hitshigh.com`;
        }

        const userCred = await createUserWithEmailAndPassword(auth, authEmail, password);
        if (loginId.includes('@')) {
           try { await sendEmailVerification(userCred.user); } catch(e) { console.error(e); }
           alert("Account created. Please check your email for a verification link.");
        }
        const newUser: UserProfile = { 
          id: userCred.user.uid, 
          role, 
          name: username, 
          email: loginId.includes('@') ? loginId : '', 
          phone: phoneSignup,
          isCompleted: false,
          isBlocked: false,
          isRedFlagged: false
        };
        await setDoc(doc(db, 'users', userCred.user.uid), newUser);
        window.location.reload();
      }
    } catch (error: any) {
      alert("Error: " + error.message);
    }
    setLoading(false);
  };

  return (
    <motion.div 
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="flex flex-col items-center justify-center min-h-screen px-6 py-12"
    >
      <div className="w-full max-w-sm mb-8 text-center mt-6">
        <motion.h1 
          initial={{ y: -20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: 0.2 }}
          className="text-4xl font-extrabold tracking-tighter text-white mb-2"
        >
          HITSHIGH
        </motion.h1>
        <motion.p 
          initial={{ y: -10, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: 0.3 }}
          className="text-teal-400 font-medium tracking-wide text-sm"
        >
          Just press, we do the rest
        </motion.p>
      </div>

      <motion.form 
        initial={{ y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: 0.4 }}
        onSubmit={handleSubmit} className="w-full max-w-sm bg-gray-900/60 backdrop-blur-xl p-8 rounded-3xl border border-gray-800 shadow-2xl relative z-10"
      >
        <div className="text-center mb-8">
           <h2 className="text-2xl font-bold text-white mb-2">
              {authMode === 'login' ? 'Welcome Back' : authMode === 'signup-user' ? 'Client Registration' : authMode === 'signup-vendor' ? 'Provider Registration' : 'Reset Password'}
           </h2>
           <p className="text-gray-400 text-sm">
              {authMode === 'login' ? 'Enter your credentials to continue.' : authMode === 'forgot-password' ? 'We will send you a reset link.' : 'Create an account to get started.'}
           </p>
        </div>

        <div className="space-y-4">
          {(authMode === 'signup-user' || authMode === 'signup-vendor') && (
            <input 
              type="text" placeholder={authMode === 'signup-vendor' ? "Provider/Business Name" : "Full Name"} required value={username} onChange={e => setUsername(e.target.value)}
              className="w-full bg-gray-950 border border-gray-800 rounded-xl px-4 py-3 focus:outline-none focus:border-teal-500 transition-colors text-white placeholder-gray-500 text-sm"
            />
          )}
          <input 
            type="text" placeholder={authMode === 'login' ? "Email or Phone Number" : "Email Address"} required value={loginId} onChange={e => setLoginId(e.target.value)}
            className="w-full bg-gray-950 border border-gray-800 rounded-xl px-4 py-3 focus:outline-none focus:border-teal-500 transition-colors text-white placeholder-gray-500 text-sm"
          />
          {(authMode === 'signup-user' || authMode === 'signup-vendor') && (
            <input 
              type="tel" placeholder="Phone Number" required value={phoneSignup} onChange={e => setPhoneSignup(e.target.value)}
              className="w-full bg-gray-950 border border-gray-800 rounded-xl px-4 py-3 focus:outline-none focus:border-teal-500 transition-colors text-white placeholder-gray-500 text-sm"
            />
          )}
          {authMode !== 'forgot-password' && (
            <div className="relative">
              <input 
                type={showPassword ? "text" : "password"} placeholder="Password" required value={password} onChange={e => setPassword(e.target.value)}
                className="w-full bg-gray-950 border border-gray-800 rounded-xl px-4 py-3 focus:outline-none focus:border-teal-500 transition-colors text-white placeholder-gray-500 text-sm"
              />
              <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-500 hover:text-white transition-colors">
                {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
          )}
          {(authMode === 'signup-user' || authMode === 'signup-vendor') && (
            <div className="relative">
              <input 
                type={showConfirmPassword ? "text" : "password"} placeholder="Confirm Password" required value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)}
                className="w-full bg-gray-950 border border-gray-800 rounded-xl px-4 py-3 focus:outline-none focus:border-teal-500 transition-colors text-white placeholder-gray-500 text-sm"
              />
              <button type="button" onClick={() => setShowConfirmPassword(!showConfirmPassword)} className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-500 hover:text-white transition-colors">
                {showConfirmPassword ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
          )}
          
          {authMode === 'login' && (
            <div className="flex justify-end px-1 mt-1">
              <button type="button" onClick={() => setAuthMode('forgot-password')} className="text-xs text-teal-500 hover:text-teal-400 font-medium">Forgot Password?</button>
            </div>
          )}

          <motion.button 
            whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}
            type="submit" disabled={loading} className="w-full bg-gradient-to-r from-teal-500 to-teal-700 text-white font-bold py-4 rounded-xl shadow-[0_0_20px_rgba(20,184,166,0.3)] mt-2 disabled:opacity-50"
          >
            {loading ? 'Processing...' : (authMode === 'forgot-password' ? 'Reset Password' : (authMode === 'login' ? 'Sign In' : 'Create Account'))}
          </motion.button>
        </div>

        {authMode === 'forgot-password' && (
          <div className="mt-6 text-center text-sm">
             <button type="button" onClick={() => setAuthMode('login')} className="text-teal-500 hover:text-teal-400">Back to Login</button>
          </div>
        )}

        {authMode !== 'forgot-password' && (
          <>
            <div className="mt-6 flex items-center">
               <div className="flex-grow border-t border-gray-800"></div>
               <span className="mx-4 text-xs font-bold text-gray-500 bg-gray-900/60 shadow rounded-full uppercase tracking-widest">Or Continue With</span>
               <div className="flex-grow border-t border-gray-800"></div>
            </div>

            <div className="flex space-x-3 mt-6">
              <motion.button
                whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}
            type="button"
            onClick={handleAppleLogin}
            className="flex-1 bg-[#1A1A1A] hover:bg-[#252525] border border-gray-800 flex items-center justify-center space-x-2 text-white font-bold py-3.5 rounded-xl shadow-lg transition-colors text-sm"
          >
            <svg className="w-4 h-4" viewBox="0 0 384 512" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
              <path d="M318.7 268.7c-.2-36.7 16.4-64.4 50-84.8-18.8-26.9-47.2-41.7-84.7-44.6-35.5-2.8-74.3 20.7-88.5 20.7-15 0-49.4-19.7-76.4-19.7C63.3 141.2 4 184.8 4 273.5c0 26.2 4.8 53.3 14.4 81.2 12.8 36.7 59 126.7 107.2 125.2 25.2-.6 43-17.9 75.8-17.9 31.8 0 48.3 17.9 76.4 17.9 48.6-.7 90.4-82.5 102.6-119.3-65.2-30.7-61.7-90-61.7-91.9zm-56.6-164.2c27.3-32.4 24.8-61.9 24-72.5-24.1 1.4-52 16.4-67.9 34.9-17.5 19.8-27.8 44.3-25.6 71.9 26.1 2 49.9-11.4 69.5-34.3z"/>
            </svg>
            <span>Apple</span>
          </motion.button>
          <motion.button
            whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}
            type="button"
            onClick={handleGoogleLogin}
            className="flex-1 bg-white hover:bg-gray-100 flex items-center justify-center space-x-2 text-black font-bold py-3.5 rounded-xl shadow-lg transition-colors text-sm"
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
              <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
              <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
              <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
            </svg>
            <span>Google</span>
          </motion.button>
        </div>
        </>
        )}
        
        <div className="mt-8 space-y-3 pt-6 border-t border-gray-800">
          {authMode === 'login' && (
            <>
              <button type="button" onClick={() => setAuthMode('signup-user')} className="w-full text-center text-sm text-gray-400 hover:text-white transition-colors">Don't have an account? <span className="text-teal-500 font-bold">Sign up as a Client</span></button>
              <button type="button" onClick={() => setAuthMode('signup-vendor')} className="w-full text-center text-sm text-gray-400 hover:text-white transition-colors">Want to offer services? <span className="text-teal-500 font-bold">Sign up as a Provider</span></button>
            </>
          )}
          {(authMode === 'signup-user' || authMode === 'signup-vendor') && (
             <button type="button" onClick={() => setAuthMode('login')} className="w-full text-center text-sm text-gray-400 hover:text-white transition-colors">Already have an account? <span className="text-teal-500 font-bold">Sign in here</span></button>
          )}
        </div>
      </motion.form>
    </motion.div>
  );
}

// 2. Home Screen
function HomeScreen({ currentUser, onStartBooking, vendors, onVendorSelect, onUpdateLocation }: { currentUser: UserProfile | null, onStartBooking: () => void, vendors: UserProfile[], onVendorSelect: (id: string) => void, onUpdateLocation: (location: string) => void }) {
  const container = { hidden: { opacity: 0 }, show: { opacity: 1, transition: { staggerChildren: 0.1 } } };
  const item = { hidden: { opacity: 0, y: 20 }, show: { opacity: 1, y: 0 } };
  const [searchQuery, setSearchQuery] = useState('');
  const [filterVerified, setFilterVerified] = useState(false);
  const [isLocating, setIsLocating] = useState(false);

  const filteredVendors = vendors.filter(v => 
    (!filterVerified || v.verificationStatus === 'approved') &&
    (v.name.toLowerCase().includes(searchQuery.toLowerCase()) || 
    (v.services && v.services.some(s => s.toLowerCase().includes(searchQuery.toLowerCase()))) ||
    (v.description && v.description.toLowerCase().includes(searchQuery.toLowerCase())) ||
    (searchQuery !== '' && v.description && v.description.toLowerCase().includes('event')) ||
    (v.locations && v.locations.some(l => l.toLowerCase().includes(searchQuery.toLowerCase()))))
  ).sort((a, b) => {
    // If user has a location, prioritize vendors in that location
    if (currentUser?.location) {
      const aMatches = a.locations?.some(l => l.toLowerCase().includes(currentUser.location!.toLowerCase()));
      const bMatches = b.locations?.some(l => l.toLowerCase().includes(currentUser.location!.toLowerCase()));
      if (aMatches && !bMatches) return -1;
      if (!aMatches && bMatches) return 1;
    }
    return 0;
  });

  const detectLocation = () => {
    if (!navigator.geolocation) {
      alert("Geolocation is not supported by your browser");
      return;
    }
    setIsLocating(true);
    navigator.geolocation.getCurrentPosition(async (position) => {
      try {
        const res = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${position.coords.latitude}&lon=${position.coords.longitude}&zoom=10`);
        const data = await res.json();
        const city = data.address.city || data.address.town || data.address.village || data.address.county;
        if (city) {
          onUpdateLocation(city);
        } else {
          alert("Could not determine city from location.");
        }
      } catch (err) {
        alert("Failed to fetch location data.");
      } finally {
        setIsLocating(false);
      }
    }, () => {
      alert("Failed to get your location. Please allow location permissions.");
      setIsLocating(false);
    });
  };

  return (
    <div className="pb-24 pt-12 px-6 max-w-md lg:max-w-6xl mx-auto w-full">
      <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="mb-6 flex justify-between items-start">
        <div>
          <h2 className="text-2xl font-bold text-white mb-1">
            {currentUser ? `Hello, ${currentUser.name}` : 'Welcome to HITSHIGH'}
          </h2>
          <p className="text-gray-400">What service do you need?</p>
        </div>
        <button 
          onClick={detectLocation} 
          disabled={isLocating}
          className="flex items-center gap-1.5 bg-gray-900 border border-gray-800 px-3 py-1.5 rounded-full text-xs font-medium text-gray-300 hover:text-white transition-colors"
        >
          <MapPin size={14} className={isLocating ? "animate-pulse text-teal-500" : "text-teal-500"} />
          {isLocating ? 'Locating...' : (currentUser?.location || 'Set Location')}
        </button>
      </motion.div>

      {/* Global Search Bar */}
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.1 }} className="mb-6">
        <div className="relative mb-3">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" size={20} />
          <input 
            type="text" 
            placeholder="Search services, providers, or locations..." 
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-gray-900 border border-gray-800 rounded-full py-4 pl-12 pr-4 focus:outline-none focus:border-teal-500 text-white placeholder-gray-500 shadow-lg"
          />
        </div>
        <div className="flex px-2 space-x-3">
          <button 
            onClick={() => setFilterVerified(false)} 
            className={`px-4 py-1.5 rounded-full text-xs font-bold transition-colors ${!filterVerified ? 'bg-teal-600 text-white' : 'bg-gray-800 text-gray-400 hover:text-white hover:bg-gray-700'}`}
          >
            All
          </button>
          <button 
            onClick={() => setFilterVerified(true)} 
            className={`px-4 py-1.5 rounded-full text-xs font-bold transition-colors flex items-center space-x-1 ${filterVerified ? 'bg-teal-600 text-white' : 'bg-gray-800 text-gray-400 hover:text-white hover:bg-gray-700'}`}
          >
            <span>Verified</span>
            <CheckCircle size={12} className={filterVerified ? "text-white" : "text-blue-500"} />
          </button>
        </div>
      </motion.div>

      {searchQuery ? (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
          <h3 className="text-lg font-bold mb-4">Search Results</h3>
          {filteredVendors.length === 0 ? (
            <p className="text-gray-500 text-center py-8">No vendors found matching "{searchQuery}"</p>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
               {filteredVendors.map((vendor, i) => (
                  <div key={i} onClick={() => onVendorSelect(vendor.id)} className="bg-gray-900 border border-gray-800 rounded-2xl p-5 cursor-pointer hover:bg-gray-800 transition-colors">
                    <div className="flex justify-between items-start mb-3">
                      <div className="flex items-center space-x-3">
                        {vendor.profilePic ? (
                           <img src={vendor.profilePic} alt={vendor.name} className="w-12 h-12 rounded-full object-cover border border-gray-700" />
                        ) : (
                           <div className="w-12 h-12 bg-gray-800 rounded-full flex items-center justify-center">
                             <User size={24} className="text-gray-400" />
                           </div>
                        )}
                        <div>
                           <h4 className="font-bold text-lg flex items-center space-x-1">
                             <span className="truncate">{vendor.name}</span>
                             {vendor.verificationStatus === 'approved' && <CheckCircle size={14} className="text-blue-500 fill-current ml-1" />}
                           </h4>
                           <div className="flex items-center text-gray-400 space-x-1 text-xs mt-0.5">
                             <MapPin size={12} />
                             <span>{vendor.locations?.join(', ') || 'Multiple locations'}</span>
                           </div>
                        </div>
                      </div>
                      <div className="flex items-center space-x-1 bg-gray-950 px-2 py-1 rounded-lg shrink-0">
                        <Star size={14} className="text-yellow-500 fill-yellow-500" />
                        <span className="text-sm font-bold">{vendor.rating}</span>
                      </div>
                    </div>
                  </div>
                ))}
            </div>
          )}
        </motion.div>
      ) : (
        <>
          {/* Quick Categories */}
      <motion.div variants={container} initial="hidden" animate="show" className="grid grid-cols-4 gap-4 mb-10">
        {[
          { icon: '🎂', label: 'Birthday' },
          { icon: '💍', label: 'Engagement' },
          { icon: '🕌', label: 'Nikah' },
          { icon: '🎉', label: 'Party' }
        ].map((cat, i) => (
          <motion.button variants={item} key={i} onClick={() => setSearchQuery(cat.label)} className="flex flex-col items-center group">
            <div className="w-16 h-16 bg-gray-900 border border-gray-800 rounded-2xl flex justify-center items-center text-3xl mb-2 group-hover:bg-gray-800 transition-colors shadow-md relative overflow-hidden">
               <div className="absolute inset-0 bg-teal-500/10 opacity-0 group-hover:opacity-100 transition-opacity"></div>
              {cat.icon}
            </div>
            <span className="text-xs font-semibold text-gray-300">{cat.label}</span>
          </motion.button>
        ))}
      </motion.div>

      {/* Banners */}
      <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: 0.3 }} className="mb-10">
        <div className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-teal-900/60 to-[#0a1f18] border border-teal-800/50 p-6 flex flex-col justify-center min-h-[160px]">
          <div className="absolute top-0 right-0 p-4 opacity-10">
             <Star size={100} />
          </div>
          <span className="bg-teal-500 text-black text-xs font-bold uppercase tracking-wider px-3 py-1 rounded-full w-max mb-3">Promo</span>
          <h3 className="text-2xl font-bold text-white leading-tight mb-2">Premium Setups<br/>20% Off</h3>
          <p className="text-teal-200/70 text-sm">Valid until weekend</p>
        </div>
      </motion.div>

      {/* Top Vendors Scroll */}
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.4 }}>
        <div className="flex justify-between items-end mb-4">
          <h3 className="text-lg font-bold">Discover Providers</h3>
          <button className="text-teal-500 text-sm font-medium">See all</button>
        </div>
        <div className="flex overflow-x-auto gap-4 pb-4 snap-x no-scrollbar">
          {vendors.map((vendor, i) => (
            <div key={i} onClick={() => onVendorSelect(vendor.id)} className="min-w-[240px] bg-gray-900 border border-gray-800 rounded-2xl p-5 snap-start shrink-0 cursor-pointer hover:bg-gray-800 transition-colors">
              <div className="flex justify-between items-start mb-3">
                {vendor.profilePic ? (
                  <img src={vendor.profilePic} alt="profile" className="w-12 h-12 rounded-full object-cover border border-gray-700" />
                ) : (
                  <div className="w-12 h-12 bg-gray-800 rounded-full flex items-center justify-center">
                    <User size={24} className="text-gray-400" />
                  </div>
                )}
                <div className="flex items-center space-x-1 bg-gray-950 px-2 py-1 rounded-lg">
                  <Star size={14} className="text-yellow-500 fill-yellow-500" />
                  <span className="text-sm font-bold">{vendor.rating}</span>
                </div>
              </div>
              <h4 className="font-bold text-lg mb-1 flex items-center space-x-1">
                <span className="truncate">{vendor.name}</span>
                {vendor.verificationStatus === 'approved' && <CheckCircle size={14} className="text-blue-500 fill-current ml-1" />}
              </h4>
              <div className="flex items-center text-gray-400 space-x-1 text-sm">
                <MapPin size={14} />
                <span>{vendor.locations?.[0] || 'Multiple locations'}</span>
              </div>
            </div>
          ))}
        </div>
      </motion.div>
        </>
      )}
    </div>
  );
}

// 3. Booking Flow
function BookingFlow({ vendor, onComplete, onCancel }: { vendor?: UserProfile | null, onComplete: (b: any) => void, onCancel: () => void }) {
  const [step, setStep] = useState(1);
  const [data, setData] = useState({ type: '', package: '', location: '', date: '', people: '' });

  useEffect(() => {
    if (vendor) {
      if (!vendor.services || vendor.services.length === 0) {
        setData(d => ({ ...d, type: 'General Service' }));
        setStep(3); // Go straight to details
      } else if (vendor.services.length === 1) {
        setData(d => ({ ...d, type: vendor.services[0] }));
        setStep(3); // Go straight to details
      } else {
        setStep(1); // Service picker
      }
    }
  }, [vendor]);

  const containerVariants = { hidden: { opacity: 0, x: 20 }, visible: { opacity: 1, x: 0, transition: { duration: 0.3 } }, exit: { opacity: 0, x: -20 } };

  return (
    <div className="fixed inset-0 bg-gray-950 z-50 flex flex-col">
      <div className="flex items-center justify-between p-6 border-b border-gray-900 bg-gray-950/80 backdrop-blur-lg sticky top-0 z-10">
        <button onClick={() => {
           if (vendor) {
              if (step === 3 && vendor.services && vendor.services.length > 1) setStep(1);
              else onCancel();
           } else {
              if (step === 1) onCancel();
              else setStep(step - 1);
           }
        }} className="p-2 bg-gray-900 rounded-full text-white">
          <X size={20} />
        </button>
        <div className="flex space-x-1">
          {[1,2,3,4].map(i => (
             <div key={i} className={`h-1.5 w-8 rounded-full ${i <= step ? 'bg-teal-500' : 'bg-gray-800'}`}></div>
          ))}
        </div>
        <div className="w-9" /> {/* spacer */}
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        <AnimatePresence mode="wait">
          {step === 1 && (
            <motion.div key="s1" variants={containerVariants} initial="hidden" animate="visible" exit="exit" className="max-w-md lg:max-w-3xl mx-auto">
              <h2 className="text-3xl font-bold mb-8">What service do you need?</h2>
              <div className="grid grid-cols-2 gap-4">
                {vendor ? (
                  vendor.services?.map(cat => (
                    <motion.button 
                      whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}
                      key={cat} onClick={() => { setData({...data, type: cat}); setStep(3); }}
                      className="p-6 bg-gray-900 border border-gray-800 rounded-3xl flex flex-col items-center justify-center text-center space-y-3 hover:border-teal-500 hover:bg-gray-800/50 transition-colors"
                    >
                      <span className="font-semibold">{cat}</span>
                    </motion.button>
                  ))
                ) : (
                  [{i: '📸', t: 'Photography'}, {i: '🍽️', t: 'Catering'}, {i: '🎧', t: 'DJ'}, {i: '🎈', t: 'Decoration'}, {i: '🏢', t: 'Venue'}].map(cat => (
                    <motion.button 
                      whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}
                      key={cat.t} onClick={() => { setData({...data, type: cat.t}); setStep(2); }}
                      className="p-6 bg-gray-900 border border-gray-800 rounded-3xl flex flex-col items-center justify-center text-center space-y-3 hover:border-teal-500 hover:bg-gray-800/50 transition-colors"
                    >
                      <span className="text-4xl">{cat.i}</span>
                      <span className="font-semibold">{cat.t}</span>
                    </motion.button>
                  ))
                )}
              </div>
            </motion.div>
          )}

          {step === 2 && !vendor && (
            <motion.div key="s2" variants={containerVariants} initial="hidden" animate="visible" exit="exit" className="max-w-md lg:max-w-3xl mx-auto space-y-4">
              <h2 className="text-3xl font-bold mb-6">Choose a Package</h2>
              {[
                { n: 'Minimal', p: '$299', d: 'Basic decoration, Small setup, Budget-friendly' },
                { n: 'Medium', p: '$599', d: 'Theme decor, Photography, Cake + setup' },
                { n: 'Premium', p: '$1,299', d: 'Full luxury setup, Live food, Photo + Video', rec: true }
              ].map(pkg => (
                <div key={pkg.n} className={`relative p-1 rounded-3xl ${pkg.rec ? 'bg-gradient-to-br from-teal-400 to-teal-700' : 'bg-transparent'}`}>
                  {pkg.rec && <div className="absolute -top-3 right-6 bg-teal-500 text-black text-xs font-bold px-3 py-1 rounded-full shadow-lg">RECOMMENDED</div>}
                  <div 
                    onClick={() => { setData({...data, package: pkg.n}); setStep(3); }}
                    className="bg-gray-900 border border-gray-800 p-6 rounded-[22px] cursor-pointer hover:bg-gray-800 transition-colors"
                  >
                    <div className="flex justify-between items-end mb-2">
                      <h3 className="text-xl font-bold">{pkg.n}</h3>
                      <span className="text-2xl font-black text-teal-400">{pkg.p}</span>
                    </div>
                    <p className="text-gray-400 text-sm leading-relaxed">{pkg.d}</p>
                  </div>
                </div>
              ))}
            </motion.div>
          )}

          {step === 3 && (
            <motion.div key="s3" variants={containerVariants} initial="hidden" animate="visible" exit="exit" className="max-w-md lg:max-w-3xl mx-auto">
              <h2 className="text-3xl font-bold mb-8">Details</h2>
              <div className="space-y-5 flex flex-col">
                <div className="space-y-4">
                  <LocationAutocomplete value={data.location} onChange={v => setData({...data, location: v})} placeholder="Location 📍" single={true} />
                  <input type="datetime-local" className="w-full bg-gray-900 border border-gray-800 rounded-xl px-4 py-3 focus:border-teal-500 outline-none text-white [color-scheme:dark]" value={data.date} onChange={e => setData({...data, date: e.target.value})} />
                  <input type="number" placeholder="Number of people 👥" className="w-full bg-gray-900 border border-gray-800 rounded-xl px-4 py-3 focus:border-teal-500 outline-none" value={data.people} onChange={e => setData({...data, people: e.target.value})} />
                </div>
                <motion.button 
                  whileTap={{ scale: 0.98 }} onClick={() => setStep(4)}
                  className="w-full bg-teal-600 text-white font-bold text-lg py-5 rounded-2xl shadow-[0_10px_30px_rgba(20,184,166,0.3)] mt-8"
                >
                  Confirm Booking details
                </motion.button>
              </div>
            </motion.div>
          )}

          {step === 4 && (
            <motion.div key="s4" variants={containerVariants} initial="hidden" animate="visible" exit="exit" className="max-w-md lg:max-w-3xl mx-auto flex flex-col items-center justify-center min-h-[60vh] text-center">
              <motion.div 
                initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: 'spring', bounce: 0.5 }}
                className="w-24 h-24 bg-teal-500/20 text-teal-400 rounded-full flex items-center justify-center mb-6"
              >
                <CheckCircle size={48} />
              </motion.div>
              <h2 className="text-3xl font-bold mb-2">We've got your request! 🎉</h2>
              <p className="text-gray-400 mb-10">{vendor ? `Your request has been sent to ${vendor.name}. They will review it shortly.` : `Our teams will assign the best vendor for your ${data.type} shortly.`}</p>
              
              <div className="w-full space-y-4">
                <motion.button whileTap={{ scale: 0.98 }} onClick={() => onComplete({...data, id: crypto.randomUUID(), vendorId: vendor ? vendor.id : 'none', status: 'pending'})} className="w-full flex items-center justify-center space-x-2 bg-teal-600 text-white font-bold py-4 rounded-xl">
                   <CheckCircle size={20} />
                   <span>Done</span>
                </motion.button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

// 4. Vendor Profile Setup
function VendorProfile({ user, onUpdate, onLogout }: { user: UserProfile | null, onUpdate: (u: UserProfile) => Promise<void> | void, onLogout: () => void }) {
  if (!user) return null;
  const [showSuccess, setShowSuccess] = useState(false);
  const predefinedServices = ['Photography', 'Catering', 'DJ', 'Decoration', 'Makeup', 'Venue'];
  const [formData, setFormData] = useState({
    name: user.name || '',
    phone: user.phone || '',
    description: user.description || '',
    locations: user.locations ? user.locations.join(', ') : '',
    instagram: user.instagram || '',
    profilePic: user.profilePic || '',
    portfolio: user.portfolio || [],
    services: user.services || [],
    verificationStatus: user.verificationStatus || 'none'
  });
  const [customService, setCustomService] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  const toggleService = (s: string) => {
    setFormData(prev => ({
      ...prev,
      services: prev.services.includes(s) ? prev.services.filter(x => x !== s) : [...prev.services, s]
    }));
  };

  const addCustomService = () => {
    if (customService.trim() && !formData.services.includes(customService.trim())) {
      setFormData(prev => ({...prev, services: [...prev.services, customService.trim()]}));
      setCustomService('');
    }
  };

  const requestVerification = async () => {
    if (window.confirm("Request a verified badge? This will be reviewed by admins.")) {
      await onUpdate({ ...user, verificationStatus: 'pending' });
      setFormData(prev => ({ ...prev, verificationStatus: 'pending' }));
      setSuccessMsg("Verification requested successfully. Please wait for admin approval.");
      setTimeout(() => setSuccessMsg(''), 4000);
    }
  };

  const handleSave = async () => {
    await onUpdate({
      ...user,
      ...formData,
      locations: formData.locations.split(',').map(s => s.trim()).filter(Boolean),
      isCompleted: !!(formData.phone && formData.description && formData.locations && formData.services.length > 0)
    });
    setShowSuccess(true);
    setTimeout(() => setShowSuccess(false), 3000);
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>, field: 'profilePic' | 'portfolio') => {
    if (e.target.files) {
      const files = Array.from(e.target.files);
      files.forEach((file: any) => {
        const reader = new FileReader();
        reader.onloadend = () => {
          const base64String = reader.result as string;
          if (field === 'portfolio') {
            setFormData(prev => ({...prev, portfolio: [...prev.portfolio, base64String]}));
          } else {
            setFormData(prev => ({...prev, profilePic: base64String}));
          }
        };
        reader.readAsDataURL(file);
      });
    }
  }

  return (
    <div className="p-6 pt-12 pb-24 max-w-md lg:max-w-3xl mx-auto">
      <div className="flex justify-between items-center mb-8">
        <h2 className="text-3xl font-extrabold text-white tracking-tight">Provider Portal</h2>
        <button onClick={onLogout} className="text-sm text-red-400 bg-red-400/10 px-3 py-1 rounded-full">Sign out</button>
      </div>

      {!user.isCompleted && (
        <div className="bg-amber-500/10 border border-amber-500/30 text-amber-200 p-4 rounded-2xl mb-6 flex items-start space-x-3">
          <AlertTriangle size={20} className="shrink-0 mt-0.5" />
          <p className="text-sm">Please complete your profile to become visible to clients in searches.</p>
        </div>
      )}

      {user.isRedFlagged && (
        <div className="bg-red-500/10 border border-red-500/50 text-red-400 p-4 rounded-2xl mb-6 flex items-start space-x-3">
          <ShieldAlert size={20} className="shrink-0 mt-0.5" />
          <p className="text-sm">Your account has been restricted pending admin review.</p>
        </div>
      )}

      <div className="flex flex-col items-center mb-8">
        <div className="relative w-24 h-24 bg-gray-800 rounded-full flex items-center justify-center overflow-hidden border-2 border-gray-700 mb-2">
           {formData.profilePic ? <img src={formData.profilePic} alt="profile" className="w-full h-full object-cover" /> : <User size={32} className="text-gray-400" />}
           <input type="file" accept="image/*" onChange={(e) => handleFileUpload(e, 'profilePic')} className="absolute inset-0 opacity-0 cursor-pointer z-10" />
        </div>
        <span className="text-xs text-gray-500">Tap to update logo</span>
      </div>

      <div className="space-y-4">
        <div className="space-y-2">
          <label className="text-xs font-bold text-gray-500 uppercase tracking-widest pl-1">Verification Status</label>
          <div className="flex items-center justify-between bg-gray-900 border border-gray-800 rounded-xl px-4 py-3">
             <div className="flex items-center space-x-2">
               {formData.verificationStatus === 'approved' ? <CheckCircle size={20} className="text-blue-500" /> : <ShieldCheck size={20} className="text-gray-500" />}
               <span className="text-white capitalize">{formData.verificationStatus || 'None'}</span>
             </div>
             {(formData.verificationStatus === 'none' || formData.verificationStatus === 'rejected' || !formData.verificationStatus) && (
               <button onClick={requestVerification} className="text-xs bg-teal-600 hover:bg-teal-500 py-1.5 px-3 rounded-full text-white font-medium transition-colors">Request Badge</button>
             )}
             {formData.verificationStatus === 'pending' && (
               <span className="text-xs bg-yellow-500/20 text-yellow-500 py-1.5 px-3 rounded-full font-medium">Pending Review</span>
             )}
          </div>
          {successMsg && <p className="text-teal-400 text-xs px-2">{successMsg}</p>}
        </div>

        <div className="space-y-2">
          <label className="text-xs font-bold text-gray-500 uppercase tracking-widest pl-1">Services Provided *</label>
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
             <div className="flex flex-wrap gap-2 mb-4">
               {predefinedServices.map(s => (
                 <label key={s} className={`cursor-pointer px-3 py-1.5 rounded-full border text-sm transition-colors ${formData.services.includes(s) ? 'bg-teal-600/20 border-teal-500 text-teal-400' : 'bg-gray-800 border-gray-700 text-gray-400 hover:text-white hover:border-gray-500'}`}>
                   <input type="checkbox" className="hidden" checked={formData.services.includes(s)} onChange={() => toggleService(s)} />
                   {s}
                 </label>
               ))}
               {formData.services.filter(s => !predefinedServices.includes(s)).map(s => (
                 <label key={s} className="cursor-pointer px-3 py-1.5 rounded-full border text-sm transition-colors bg-teal-600/20 border-teal-500 text-teal-400">
                   <input type="checkbox" className="hidden" checked onChange={() => toggleService(s)} />
                   {s} <X size={12} className="inline ml-1 mb-0.5" />
                 </label>
               ))}
             </div>
             <div className="flex space-x-2">
                <input type="text" value={customService} onChange={e => setCustomService(e.target.value)} placeholder="Custom service..." className="flex-1 bg-gray-950 border border-gray-800 rounded-lg px-3 py-2 text-sm focus:border-teal-500 outline-none" />
                <button onClick={addCustomService} className="bg-gray-800 hover:bg-gray-700 px-3 py-2 text-sm rounded-lg text-white">Add</button>
             </div>
          </div>
        </div>

        <div className="space-y-2">
          <label className="text-xs font-bold text-gray-500 uppercase tracking-widest pl-1">Business Name</label>
          <input type="text" value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} className="w-full bg-gray-900 border border-gray-800 rounded-xl px-4 py-3 focus:border-teal-500 outline-none transition-colors" />
        </div>
        <div className="space-y-2">
          <label className="text-xs font-bold text-gray-500 uppercase tracking-widest pl-1">Contact Phone *</label>
          <input type="text" value={formData.phone} onChange={e => setFormData({...formData, phone: e.target.value})} className="w-full bg-gray-900 border border-gray-800 rounded-xl px-4 py-3 focus:border-teal-500 outline-none transition-colors" />
        </div>
        <div className="space-y-2">
          <label className="text-xs font-bold text-gray-500 uppercase tracking-widest pl-1">Service Locations * (comma separated)</label>
          <LocationAutocomplete value={formData.locations} onChange={v => setFormData({...formData, locations: v})} placeholder="e.g. Brooklyn, Manhattan" />
        </div>
         <div className="space-y-2">
          <label className="text-xs font-bold text-gray-500 uppercase tracking-widest pl-1">Instagram Link</label>
          <input type="url" value={formData.instagram} onChange={e => setFormData({...formData, instagram: e.target.value})} className="w-full bg-gray-900 border border-gray-800 rounded-xl px-4 py-3 focus:border-teal-500 outline-none transition-colors" placeholder="https://instagram.com/..." />
        </div>
        <div className="space-y-2">
          <label className="text-xs font-bold text-gray-500 uppercase tracking-widest pl-1">About Your Work *</label>
          <textarea rows={4} value={formData.description} onChange={e => setFormData({...formData, description: e.target.value})} className="w-full bg-gray-900 border border-gray-800 rounded-xl px-4 py-3 focus:border-teal-500 outline-none transition-colors" />
        </div>
        
        <div className="space-y-2 pt-2">
          <label className="text-xs font-bold text-gray-500 uppercase tracking-widest pl-1">Portfolio (Images/Videos)</label>
          <div className="grid grid-cols-3 gap-2">
             {formData.portfolio.map((img, idx) => (
                <div key={idx} className="aspect-square bg-gray-800 rounded-lg overflow-hidden border border-gray-700">
                  <img src={img} className="w-full h-full object-cover" alt="portfolio item" />
                </div>
             ))}
             <label className="aspect-square bg-gray-900 border-2 border-dashed border-gray-700 hover:border-teal-500 rounded-lg flex flex-col items-center justify-center text-gray-500 hover:text-teal-500 cursor-pointer transition-colors relative">
               <ImageIcon size={24} className="mb-1" />
               <span className="text-[10px] font-bold">Add Media</span>
               <input type="file" accept="image/*,video/*" multiple onChange={(e) => handleFileUpload(e, 'portfolio')} className="hidden" />
             </label>
          </div>
        </div>
        
        <button onClick={handleSave} className="w-full bg-teal-600 hover:bg-teal-500 text-white font-bold py-4 rounded-xl mt-6 transition-colors shadow-lg">Save Profile</button>
      </div>

      <AnimatePresence>
        {showSuccess && (
          <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }} className="fixed top-4 left-1/2 -translate-x-1/2 bg-teal-500 text-white px-6 py-3 rounded-full flex items-center space-x-2 shadow-xl z-50">
            <CheckCircle size={20} />
            <span className="font-bold">Profile updated!</span>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// 5. User Profile Screen
function UserProfileScreen({ user, onUpdate, onLogout }: { user: UserProfile | null, onUpdate: (u: UserProfile) => Promise<void> | void, onLogout: () => void }) {
  if (!user) return null;
  const [showSuccess, setShowSuccess] = useState(false);
  const [formData, setFormData] = useState({ 
    name: user.name || '', 
    email: user.email || '',
    phone: user.phone || '',
    location: user.location || '',
    profilePic: user.profilePic || ''
  });

  const handleSave = async () => {
    await onUpdate({ ...user, ...formData, isCompleted: !!formData.phone });
    setShowSuccess(true);
    setTimeout(() => setShowSuccess(false), 3000);
  };

  const getCompletionPercentage = () => {
    let filled = 0;
    if (formData.name) filled++;
    if (formData.email) filled++;
    if (formData.phone) filled++;
    if (formData.location) filled++;
    if (formData.profilePic) filled++;
    return Math.round((filled / 5) * 100);
  };

  const percentage = getCompletionPercentage();

  return (
    <div className="p-6 pt-12 pb-24 max-w-md lg:max-w-3xl mx-auto">
      <div className="flex justify-between items-center mb-8">
        <h2 className="text-3xl font-extrabold text-white tracking-tight">Account</h2>
        <button onClick={onLogout} className="text-sm text-red-400 bg-red-400/10 px-3 py-1 rounded-full hover:bg-red-400/20 transition-colors">Sign out</button>
      </div>

       {!user.isCompleted && (
        <div className="bg-amber-500/10 border border-amber-500/30 text-amber-200 p-4 rounded-2xl mb-6 flex items-start space-x-3">
          <AlertTriangle size={20} className="shrink-0 mt-0.5" />
          <p className="text-sm">Incomplete Profile! You must provide a phone number to message vendors.</p>
        </div>
      )}

       {user.isRedFlagged && (
        <div className="bg-red-500/10 border border-red-500/50 text-red-400 p-4 rounded-2xl mb-6 flex items-start space-x-3">
          <ShieldAlert size={20} className="shrink-0 mt-0.5" />
          <p className="text-sm">Your account has been restricted. You cannot place direct bookings currently.</p>
        </div>
      )}

      {/* Completion Graph */}
      <div className="bg-gray-900 border border-gray-800 rounded-3xl p-5 mb-8">
        <div className="flex justify-between text-sm mb-2 font-medium">
          <span className="text-gray-300">Profile Completion</span>
          <span className="text-teal-400">{percentage}%</span>
        </div>
        <div className="h-2 w-full bg-gray-800 rounded-full overflow-hidden">
          <motion.div 
            initial={{ width: 0 }} 
            animate={{ width: `${percentage}%` }} 
            transition={{ duration: 0.5, delay: 0.2 }}
            className={`h-full rounded-full ${percentage === 100 ? 'bg-teal-500' : 'bg-gradient-to-r from-teal-700 to-teal-400'}`}
          />
        </div>
      </div>

      <div className="bg-gray-900 border border-gray-800 rounded-3xl p-6 mb-8 flex items-center space-x-5">
        <div className="relative group">
          <div className="w-20 h-20 bg-gray-800 rounded-full flex items-center justify-center overflow-hidden border-2 border-gray-700 relative">
             {formData.profilePic ? <img src={formData.profilePic} alt="profile" className="w-full h-full object-cover" /> : <User size={32} className="text-gray-400" />}
             <input type="file" accept="image/*" onChange={(e) => {
                if(e.target.files && e.target.files[0]) {
                  const reader = new FileReader();
                  reader.onloadend = () => setFormData(prev => ({...prev, profilePic: reader.result as string}));
                  reader.readAsDataURL(e.target.files[0]);
                }
             }} className="absolute inset-0 opacity-0 cursor-pointer z-10" />
          </div>
          <div className="absolute inset-0 bg-black/50 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
             <Edit2 size={16} className="text-white" />
          </div>
        </div>
        <div className="flex-1">
          <input type="text" value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} className="bg-transparent border-b border-gray-700 text-xl font-bold text-white w-full outline-none focus:border-teal-500 placeholder-white pb-1" />
          <div className="mt-2 text-sm text-gray-400 flex items-center">
             Client Account
          </div>
        </div>
      </div>

       <div className="space-y-4">
        <div className="space-y-2">
          <label className="text-xs font-bold text-gray-500 uppercase tracking-widest pl-1">Email</label>
          <input type="email" value={formData.email} onChange={e => setFormData({...formData, email: e.target.value})} className="w-full bg-gray-900 border border-gray-800 rounded-xl px-4 py-4 focus:border-teal-500 outline-none transition-colors" />
        </div>
        <div className="space-y-2">
          <label className="text-xs font-bold text-gray-500 uppercase tracking-widest pl-1">Phone Number *</label>
          <input type="text" value={formData.phone} onChange={e => setFormData({...formData, phone: e.target.value})} className="w-full bg-gray-900 border border-gray-800 rounded-xl px-4 py-4 focus:border-teal-500 outline-none transition-colors" placeholder="Required for booking" />
        </div>
        <div className="space-y-2">
          <label className="text-xs font-bold text-gray-500 uppercase tracking-widest pl-1">Location</label>
          <LocationAutocomplete value={formData.location} onChange={v => setFormData({...formData, location: v})} placeholder="City, State" single={true} />
        </div>
         <button 
          onClick={handleSave} 
          className="w-full bg-teal-600 hover:bg-teal-500 text-white font-bold py-4 rounded-xl mt-4 transition-colors shadow-lg"
        >
          Update Details
        </button>
      </div>

      <AnimatePresence>
        {showSuccess && (
          <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }} className="fixed top-4 left-1/2 -translate-x-1/2 bg-teal-500 text-white px-6 py-3 rounded-full flex items-center space-x-2 shadow-xl z-50">
            <CheckCircle size={20} />
            <span className="font-bold">Profile updated!</span>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// 6. Messaging System Component
function MessagesScreen({ currentUser, users, chats, activeChatId, setActiveChatId, onSendMessage, onBook }: { currentUser: UserProfile | null, users: UserProfile[], chats: Message[], activeChatId: string | null, setActiveChatId: (id: string | null) => void, onSendMessage: (m: Message) => void, onBook?: (id: string) => void }) {
  const [newMessage, setNewMessage] = useState('');
  const [isRecording, setIsRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let interval: any;
    if (isRecording) {
      interval = setInterval(() => setRecordingSeconds(s => s + 1), 1000);
    } else {
      setRecordingSeconds(0);
    }
    return () => clearInterval(interval);
  }, [isRecording]);
  
  if (!currentUser) return null;

  // List view
  if (!activeChatId) {
    // Only show opposing roles you can interact with
    const chatPartners = users.filter(u => u.id !== currentUser.id && u.role !== 'admin' && u.role !== currentUser.role);
    
    return (
       <div className="p-6 pt-12 max-w-md lg:max-w-4xl mx-auto h-[100dvh] pb-[96px] flex flex-col">
          <h2 className="text-3xl font-extrabold text-white tracking-tight mb-8 shrink-0">Messages</h2>
          
          <div className="bg-teal-500/10 border border-teal-500/20 text-teal-200 p-4 rounded-2xl mb-6 flex items-start space-x-3 text-sm shrink-0">
            <ShieldCheck size={20} className="shrink-0 mt-0.5 text-teal-400" />
            <p>For security and quality purposes, all chats are monitored and visible to platform administration.</p>
          </div>

          <div className="flex-1 overflow-y-auto space-y-2">
            {chatPartners.map(partner => (
              <button 
                key={partner.id} onClick={() => {
                  if (currentUser.role === 'user' && !currentUser.isCompleted) {
                    alert("Please complete your profile (add phone number) to chat with vendors.");
                    return;
                  }
                  setActiveChatId(partner.id);
                }}
                className="w-full flex items-center p-4 bg-gray-900 border border-gray-800 rounded-2xl hover:bg-gray-800 transition-colors"
              >
                <div className="relative">
                  <div className="w-12 h-12 bg-gray-800 rounded-full flex justify-center items-center mr-4">
                    <User size={20} className="text-gray-400" />
                  </div>
                  {partner.isRedFlagged && (
                     <div className="absolute -top-1 -right-1 bg-gray-900 rounded-full p-0.5">
                       <Flag size={14} className="text-red-500 fill-red-500" />
                     </div>
                  )}
                </div>
                <div className="flex-1 text-left">
                  <h4 className="font-bold flex items-center gap-2">
                    {partner.name}
                  </h4>
                  <p className="text-sm text-gray-500 truncate mt-0.5">Tap to chat</p>
                </div>
              </button>
            ))}
          </div>
       </div>
    );
  }

  // Chat View
  const partner = users.find(u => u.id === activeChatId);
  const messages = chats.filter(c => 
    (c.senderId === currentUser.id && c.receiverId === activeChatId) || 
    (c.senderId === activeChatId && c.receiverId === currentUser.id)
  ).sort((a,b) => a.timestamp - b.timestamp);

  const handleSend = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newMessage.trim() && !isRecording) return;
    onSendMessage({
      id: Math.random().toString(36).substr(2,9),
      senderId: currentUser.id,
      receiverId: activeChatId!, // Ensure this is not null when sending
      text: newMessage,
      timestamp: Date.now()
    });
    setNewMessage('');
  };

  const handleSendImage = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const reader = new FileReader();
      reader.onloadend = () => {
        onSendMessage({
          id: crypto.randomUUID(),
          senderId: currentUser.id,
          receiverId: activeChatId!,
          text: '',
          imageUrl: reader.result as string,
          timestamp: Date.now()
        });
      };
      reader.readAsDataURL(e.target.files[0]);
    }
  };

  const handleStopRecording = () => {
    setIsRecording(false);
    onSendMessage({
      id: Math.random().toString(36).substr(2,9),
      senderId: currentUser.id,
      receiverId: activeChatId!,
      text: '',
      isAudio: true,
      audioDuration: recordingSeconds,
      timestamp: Date.now()
    });
  };

  return (
    <div className="flex flex-col h-[100dvh] pb-[72px] max-w-md lg:max-w-4xl mx-auto bg-gray-950">
      <div className="p-4 bg-gray-900 border-b border-gray-800 flex items-center shrink-0">
        <button onClick={() => setActiveChatId(null)} className="mr-3 p-2 hover:bg-gray-800 rounded-full text-white">
          <ChevronRight size={20} className="rotate-180" />
        </button>
        <div className="flex-1 flex justify-between items-center">
            <h3 className="font-bold flex items-center gap-2">
              {partner?.name}
              {partner?.isRedFlagged && <Flag size={14} className="text-red-500 fill-red-500" />}
            </h3>
            {currentUser.role === 'user' && partner?.role === 'vendor' && onBook && (
              <button 
                onClick={() => onBook(partner.id)} 
                className="bg-teal-600 hover:bg-teal-500 text-white px-3 py-1.5 rounded-full text-xs font-bold transition-colors flex items-center space-x-1"
              >
                <Calendar size={14} />
                <span>Book Now</span>
              </button>
            )}
        </div>
      </div>
      
       <div className="bg-gray-900/40 p-2 text-center text-xs text-gray-500 shrink-0">
         Admin monitoring is active for this conversation.
       </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4 flex flex-col">
        {messages.map(m => {
          const isSender = m.senderId === currentUser.id;
          return (
            <div key={m.id} className={`max-w-[75%] rounded-2xl px-4 py-3 text-sm ${isSender ? 'bg-teal-600 text-white self-end rounded-br-sm' : 'bg-gray-800 text-gray-100 self-start rounded-bl-sm'}`}>
              {m.imageUrl && (
                <img src={m.imageUrl} alt="Attachment" className="max-w-full rounded-xl mb-2 object-cover" />
              )}
              {m.isAudio && (
                <div className="flex items-center space-x-2 w-32">
                  <Play size={18} className="shrink-0" />
                  <div className="flex-1 bg-white/30 h-1.5 rounded-full overflow-hidden">
                    <div className="w-1/3 bg-white h-full" />
                  </div>
                  <span className="text-xs">{m.audioDuration}s</span>
                </div>
              )}
              {m.text && <div>{m.text}</div>}
            </div>
          )
        })}
      </div>

      <form onSubmit={handleSend} className="p-4 bg-gray-900 border-t border-gray-800 flex items-center gap-2 shrink-0">
        <input type="file" accept="image/*" className="hidden" ref={fileInputRef} onChange={handleSendImage} />
        {!isRecording ? (
          <>
            <button type="button" onClick={() => fileInputRef.current?.click()} className="p-3 text-gray-400 bg-gray-800 rounded-full hover:bg-gray-700 transition">
              <ImageIcon size={20} />
            </button>
            <input 
              type="text" 
              value={newMessage} 
              onChange={(e) => setNewMessage(e.target.value)} 
              placeholder="Type a message..." 
              className="flex-1 bg-gray-800 text-white rounded-full px-5 py-3 outline-none focus:border-teal-500 border border-transparent transition"
            />
            {newMessage.trim() ? (
              <button type="submit" className="bg-teal-500 text-black p-3 rounded-full hover:bg-teal-400 transition">
                <Send size={20} />
              </button>
            ) : (
              <button type="button" onClick={() => setIsRecording(true)} className="bg-gray-800 text-teal-400 p-3 rounded-full hover:bg-gray-700 transition">
                <Mic size={20} />
              </button>
            )}
          </>
        ) : (
          <div className="flex-1 flex items-center justify-between bg-teal-900/30 border border-teal-500/50 rounded-full px-5 py-2">
            <div className="flex items-center space-x-3 text-teal-400">
              <div className="w-3 h-3 bg-red-500 rounded-full animate-pulse" />
              <span className="font-mono">{Math.floor(recordingSeconds / 60)}:{(recordingSeconds % 60).toString().padStart(2, '0')}</span>
            </div>
            <button type="button" onClick={handleStopRecording} className="p-2 bg-teal-500 text-black rounded-full hover:bg-teal-400">
              <Send size={16} />
            </button>
          </div>
        )}
      </form>
    </div>
  );
}

// 6.5. Public Vendor Profile
function PublicVendorProfile({ vendorId, users, reviews, onBack, onMessage, onBook }: { vendorId: string | null, users: UserProfile[], reviews: Review[], onBack: () => void, onMessage: (id: string) => void, onBook: () => void }) {
  const vendor = users.find(u => u.id === vendorId);
  if (!vendor) return null;

  const vendorReviews = reviews.filter(r => r.vendorId === vendorId).sort((a, b) => b.timestamp - a.timestamp);

  return (
    <div className="flex flex-col min-h-screen bg-gray-950 max-w-md lg:max-w-4xl mx-auto w-full relative">
      <div className="absolute top-0 left-0 w-full h-48 bg-gradient-to-b from-teal-900/40 to-gray-950 z-0"></div>
      
      <div className="p-4 flex items-center sticky top-0 z-10">
        <button onClick={onBack} className="p-2 bg-gray-900/80 backdrop-blur rounded-full text-white">
          <X size={20} />
        </button>
      </div>

      <div className="px-6 relative z-10 flex-1 overflow-y-auto pb-40">
        <div className="flex justify-between items-start mb-6">
          <div className="w-24 h-24 bg-gray-800 rounded-full flex justify-center items-center overflow-hidden border-4 border-gray-950 shadow-xl">
            {vendor.profilePic ? (
              <img src={vendor.profilePic} alt={vendor.name} className="w-full h-full object-cover" />
            ) : (
              <User size={32} className="text-gray-400" />
            )}
          </div>
          <div className="bg-gray-900 border border-gray-800 px-3 py-1.5 rounded-xl flex items-center space-x-1 shadow-lg mt-4">
             <Star size={16} className="text-yellow-500 fill-yellow-500" />
             <span className="font-bold">{vendor.rating}</span>
          </div>
        </div>

        <h2 className="text-3xl font-extrabold mb-1 flex items-center space-x-2">
          <span>{vendor.name}</span>
          {vendor.verificationStatus === 'approved' && <CheckCircle size={24} className="text-blue-500 fill-current" />}
        </h2>
        <div className="flex items-center text-gray-400 space-x-1 text-sm mb-4">
          <MapPin size={16} />
          <span>{vendor.locations?.join(', ') || 'Various Locations'}</span>
        </div>

        {vendor.services && vendor.services.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-6">
            {vendor.services.map(s => (
               <span key={s} className="bg-teal-900/30 text-teal-400 px-3 py-1 text-xs font-bold uppercase tracking-wider rounded-full border border-teal-900/50">{s}</span>
            ))}
          </div>
        )}

        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5 mb-6">
          <h3 className="font-bold mb-2">About us</h3>
          <p className="text-gray-300 text-sm leading-relaxed">{vendor.description}</p>
        </div>

        {vendor.portfolio && vendor.portfolio.length > 0 && (
          <div className="mb-6">
            <h3 className="font-bold mb-4">Portfolio</h3>
            <div className="grid grid-cols-2 gap-3">
               {vendor.portfolio.map((item, idx) => (
                  <div key={idx} className="bg-gray-900 rounded-xl overflow-hidden aspect-square border border-gray-800 shadow-md">
                    <img src={item} alt="portfolio" className="w-full h-full object-cover" />
                  </div>
               ))}
            </div>
          </div>
        )}

        {vendor.instagram && (
          <a href={vendor.instagram} target="_blank" rel="noreferrer" className="flex items-center space-x-3 bg-gradient-to-r from-pink-600/20 to-purple-600/20 border border-pink-500/30 text-pink-200 p-4 rounded-2xl mb-8 hover:opacity-80 transition-opacity">
             <div className="bg-pink-500/20 p-2 rounded-xl">
               <User size={20} className="text-pink-400" />
             </div>
             <div>
               <p className="text-sm font-bold">Follow on Instagram</p>
               <p className="text-xs text-pink-300/70">See our latest work</p>
             </div>
          </a>
        )}

        <div className="mb-6">
          <h3 className="font-bold border-b border-gray-800 pb-2 mb-4 text-white">Client Reviews</h3>
          {vendorReviews.length === 0 ? (
            <p className="text-sm text-gray-500 italic">No reviews yet.</p>
          ) : (
            <div className="space-y-4">
              {vendorReviews.map(review => {
                const author = users.find(u => u.id === review.userId);
                return (
                  <div key={review.id} className="bg-gray-900 border border-gray-800 p-4 rounded-xl">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center space-x-2">
                        <div className="w-8 h-8 rounded-full bg-gray-800 overflow-hidden flex items-center justify-center shrink-0">
                          {author?.profilePic ? <img src={author.profilePic} alt="a" className="w-full h-full object-cover" /> : <User size={14} className="text-gray-500" />}
                        </div>
                        <div>
                          <p className="text-sm font-bold text-gray-200">{author?.name || 'Anonymous'}</p>
                          <p className="text-[10px] text-gray-500">{new Date(review.timestamp).toLocaleDateString()}</p>
                        </div>
                      </div>
                      <div className="flex text-yellow-500">
                        {[...Array(5)].map((_, i) => (
                           <Star key={i} size={12} className={i < review.rating ? "fill-yellow-500" : "text-gray-700"} />
                        ))}
                      </div>
                    </div>
                    <p className="text-sm text-gray-300 leading-relaxed mb-3">{review.comment}</p>
                    {review.reply && (
                       <div className="bg-gray-950 p-3 rounded-lg border border-gray-800 ml-4 relative">
                          <div className="absolute -left-[17px] top-4 w-4 border-t border-l border-gray-800 rounded-tl-xl h-4"></div>
                          <p className="text-[10px] font-bold text-gray-500 uppercase tracking-widest mb-1">Provider's Reply</p>
                          <p className="text-sm text-gray-400">{review.reply}</p>
                       </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>

      <div className="fixed bottom-0 max-w-md lg:max-w-4xl w-full bg-gray-950/90 backdrop-blur-xl border-t border-gray-900 p-6 z-20 flex gap-4 pb-12">
         <motion.button 
            whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}
            onClick={() => onMessage(vendor.id)}
            className="flex-1 bg-gray-800 text-white font-bold text-lg py-4 rounded-xl shadow-lg flex items-center justify-center space-x-2 border border-gray-700"
          >
            <MessageCircle size={20} />
            <span>Message</span>
          </motion.button>
         <motion.button 
            whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}
            onClick={onBook}
            className="flex-1 bg-teal-600 text-white font-bold text-lg py-4 rounded-xl shadow-[0_10px_30px_rgba(20,184,166,0.3)] flex items-center justify-center space-x-2"
          >
            <Calendar size={20} />
            <span>Book Now</span>
          </motion.button>
      </div>
    </div>
  );
}

// 6.6. Activity Screen (Bookings)
function ActivityScreen({ currentUser, bookings, reviews, users, onVendorSelect, onUpdateBooking, onMessage, onAddReview }: { currentUser: UserProfile | null, bookings: Booking[], reviews: Review[], users: UserProfile[], onVendorSelect: (id: string) => void, onUpdateBooking: (id: string, updates: Partial<Booking>) => void, onMessage?: (id: string) => void, onAddReview: (r: Review) => void }) {
  const [filter, setFilter] = useState<'all' | 'pending' | 'confirmed' | 'completed' | 'rejected'>('all');
  const [reviewFormFor, setReviewFormFor] = useState<string | null>(null);
  const [reviewData, setReviewData] = useState({ rating: 5, comment: '' });
  
  if (!currentUser) return null;

  const relevantBookings = bookings.filter(b => {
    if (currentUser.role === 'admin') return true;
    if (currentUser.role === 'vendor') return b.vendorId === currentUser.id;
    return b.userId === currentUser.id;
  }).filter(b => filter === 'all' || b.status === filter);

  return (
    <div className="p-6 pt-12 pb-24 max-w-md lg:max-w-4xl mx-auto min-h-screen">
      <h2 className="text-3xl font-extrabold text-white tracking-tight mb-6">Activity</h2>

      {currentUser.role === 'vendor' && (
         <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
            <div className="bg-gray-900 border border-gray-800 rounded-2xl p-4 flex flex-col justify-between">
              <span className="text-xs uppercase tracking-widest font-mono text-gray-500 mb-2">Total Bookings</span>
              <span className="text-3xl font-light text-white">{bookings.filter(b => b.vendorId === currentUser.id).length}</span>
            </div>
            <div className="bg-gray-900 border border-gray-800 rounded-2xl p-4 flex flex-col justify-between">
              <span className="text-xs uppercase tracking-widest font-mono text-gray-500 mb-2">Pending</span>
              <span className="text-3xl font-light text-yellow-500">{bookings.filter(b => b.vendorId === currentUser.id && b.status === 'pending').length}</span>
            </div>
            <div className="bg-gray-900 border border-gray-800 rounded-2xl p-4 flex flex-col justify-between">
              <span className="text-xs uppercase tracking-widest font-mono text-gray-500 mb-2">Confirmed</span>
              <span className="text-3xl font-light text-teal-500">{bookings.filter(b => b.vendorId === currentUser.id && b.status === 'confirmed').length}</span>
            </div>
            <div className="bg-gray-900 border border-gray-800 rounded-2xl p-4 flex flex-col justify-between">
              <span className="text-xs uppercase tracking-widest font-mono text-gray-500 mb-2">Rating</span>
              <span className="text-3xl font-light text-white flex items-center gap-1"><Star size={24} className="text-yellow-500 fill-yellow-500" /> {currentUser.rating || 'New'}</span>
            </div>
         </div>
      )}

      <div className="flex space-x-2 overflow-x-auto pb-4 mb-2 no-scrollbar">
        {['all', 'pending', 'confirmed', 'completed', 'rejected'].map(f => (
          <button 
            key={f} 
            onClick={() => setFilter(f as any)} 
            className={`px-4 py-2 rounded-full text-sm font-bold capitalize whitespace-nowrap transition-colors ${filter === f ? 'bg-teal-600 text-white shadow-lg shadow-teal-900/50' : 'bg-gray-900 text-gray-400 hover:text-white'}`}
          >
            {f}
          </button>
        ))}
      </div>

      <div className="space-y-4">
        {relevantBookings.length === 0 ? (
          <div className="bg-gray-900 border border-gray-800 rounded-3xl p-8 text-center text-gray-500">
            <Calendar size={48} className="mx-auto mb-4 opacity-50" />
            <p>No activity found.</p>
          </div>
        ) : (
          relevantBookings.map((b) => {
            const partnerId = currentUser.role === 'vendor' ? b.userId : b.vendorId;
            const partner = partnerId ? users.find(u => u.id === partnerId) : null;
            
            return (
              <div key={b.id} className="bg-gray-900 border border-gray-800 rounded-3xl p-5 relative overflow-hidden">
                <div className={`absolute top-0 right-0 px-4 py-1 text-xs font-bold rounded-bl-xl ${
                    b.status === 'confirmed' ? 'bg-teal-500 text-black' : 
                    b.status === 'completed' ? 'bg-gray-700 text-white' : 
                    b.status === 'rejected' ? 'bg-red-500/20 text-red-500' :
                    'bg-yellow-500/20 text-yellow-500'
                  }`}
                >
                  {b.status.toUpperCase()}
                </div>
                
                <h3 className="text-lg font-bold mb-1 pt-2">{b.type}</h3>
                <div className="text-sm text-gray-400 mb-4">{new Date(b.date).toLocaleDateString()} at {new Date(b.date).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</div>
                
                <div className="grid grid-cols-2 gap-y-3 gap-x-2 text-sm mb-4">
                  <div className="flex flex-col">
                    <span className="text-gray-500 text-xs">Package</span>
                    <span className="font-semibold text-gray-200">{b.package}</span>
                  </div>
                  <div className="flex flex-col">
                    <span className="text-gray-500 text-xs">Location</span>
                    <span className="font-semibold text-gray-200 truncate pr-2">{b.location}</span>
                  </div>
                  <div className="flex flex-col">
                    <span className="text-gray-500 text-xs">Guests</span>
                    <span className="font-semibold text-gray-200">{b.people}</span>
                  </div>
                </div>

                {currentUser.role === 'user' && partner && (
                  <div className="mt-4 pt-4 border-t border-gray-800 flex flex-col space-y-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center space-x-3">
                        <div className="w-8 h-8 rounded-full bg-gray-800 overflow-hidden flex items-center justify-center">
                           {partner?.profilePic ? <img src={partner.profilePic} alt="p" className="w-full h-full object-cover" /> : <User size={16} className="text-gray-500" />}
                        </div>
                        <span className="text-sm font-medium">{partner?.name}</span>
                      </div>
                      <div className="flex space-x-2">
                        {b.status !== 'rejected' && (
                          <button onClick={() => { if (onMessage && partner) onMessage(partner.id) }} className="text-xs text-blue-400 font-bold bg-blue-500/10 px-3 py-1.5 rounded-lg hover:bg-blue-500/20 transition-colors flex items-center gap-1">
                            <MessageCircle size={12} />
                            Chat Now
                          </button>
                        )}
                        <button onClick={() => onVendorSelect(partner.id)} className="text-xs text-teal-400 font-bold bg-teal-500/10 px-3 py-1.5 rounded-lg hover:bg-teal-500/20 transition-colors">
                          View Profile
                        </button>
                      </div>
                    </div>
                    {b.status === 'completed' && !b.isReviewed && (
                      <div className="bg-gray-950 p-4 rounded-xl border border-gray-800">
                        {reviewFormFor === b.id ? (
                          <div className="space-y-3">
                            <h4 className="text-sm font-bold">Leave a Review</h4>
                            <div className="flex space-x-2">
                              {[1, 2, 3, 4, 5].map(star => (
                                <button key={star} onClick={() => setReviewData({...reviewData, rating: star})}>
                                  <Star size={20} className={star <= reviewData.rating ? "text-yellow-500 fill-yellow-500" : "text-gray-600"} />
                                </button>
                              ))}
                            </div>
                            <textarea 
                              className="w-full bg-gray-900 border border-gray-800 rounded-lg p-3 text-sm focus:border-teal-500 outline-none resize-none h-20"
                              placeholder="How was the service?"
                              value={reviewData.comment}
                              onChange={(e) => setReviewData({...reviewData, comment: e.target.value})}
                            />
                            <div className="flex space-x-2 justify-end">
                              <button onClick={() => setReviewFormFor(null)} className="text-xs px-3 py-2 text-gray-400 hover:text-white">Cancel</button>
                              <button 
                                onClick={() => {
                                  onAddReview({ id: crypto.randomUUID(), bookingId: b.id, vendorId: b.vendorId!, userId: b.userId, rating: reviewData.rating, comment: reviewData.comment, timestamp: Date.now() });
                                  setReviewFormFor(null);
                                }}
                                className="text-xs px-4 py-2 bg-teal-600 hover:bg-teal-500 text-white font-bold rounded-lg transition-colors"
                              >
                                Submit
                              </button>
                            </div>
                          </div>
                        ) : (
                          <button onClick={() => { setReviewFormFor(b.id); setReviewData({ rating: 5, comment: '' }); }} className="w-full py-2 bg-teal-600/20 text-teal-500 border border-teal-500/30 rounded-lg text-sm font-bold hover:bg-teal-600/30 transition-colors">
                            Leave a Review
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                )}
                
                {currentUser.role === 'vendor' && partner && (
                  <div className="mt-4 pt-4 border-t border-gray-800">
                    <div className="flex items-center justify-between mb-4">
                      <div className="flex items-center space-x-3">
                        <div className="w-8 h-8 rounded-full bg-gray-800 overflow-hidden flex items-center justify-center">
                           {partner?.profilePic ? <img src={partner.profilePic} alt="p" className="w-full h-full object-cover" /> : <User size={16} className="text-gray-500" />}
                        </div>
                        <div className="flex flex-col flex-1">
                          <span className="text-sm font-medium">{partner?.name}</span>
                          <span className="text-xs text-gray-500">{partner?.phone}</span>
                        </div>
                        {b.status !== 'rejected' && (
                          <button onClick={() => { if (onMessage && partner) onMessage(partner.id) }} className="text-xs text-blue-400 font-bold bg-blue-500/10 px-3 py-1.5 rounded-lg hover:bg-blue-500/20 transition-colors flex items-center gap-1 shrink-0">
                            <MessageCircle size={12} />
                            Chat
                          </button>
                        )}
                      </div>
                    </div>
                    {b.status === 'pending' && (
                      <div className="flex space-x-2">
                        <button onClick={() => onUpdateBooking(b.id, { status: 'confirmed' })} className="w-full bg-teal-600/20 text-teal-500 border border-teal-500/30 text-center py-2 rounded-xl text-sm font-bold hover:bg-teal-600/30 transition-colors">
                          Accept
                        </button>
                        <button onClick={() => onUpdateBooking(b.id, { status: 'rejected' })} className="w-full bg-red-600/20 text-red-500 border border-red-500/30 text-center py-2 rounded-xl text-sm font-bold hover:bg-red-600/30 transition-colors">
                          Decline
                        </button>
                      </div>
                    )}
                    {b.status === 'confirmed' && (
                      <button onClick={() => onUpdateBooking(b.id, { status: 'completed' })} className="w-full bg-teal-600 text-white text-center py-2 rounded-xl text-sm font-bold hover:bg-teal-500 transition-colors">
                        Mark as Completed
                      </button>
                    )}
                  </div>
                )}

                {currentUser.role === 'user' && !partner && (
                  <div className="mt-4 pt-4 border-t border-gray-800 flex items-center">
                    <div className="text-sm text-yellow-500/70 border border-yellow-500/20 bg-yellow-500/10 px-3 py-1.5 rounded-lg">Assigning vendor...</div>
                  </div>
                )}
              </div>
            )
          })
        )}
      </div>
    </div>
  );
}

// Vendor Reviews Screen
function VendorReviewsScreen({ vendor, reviews, users, onReply }: { vendor: UserProfile, reviews: Review[], users: UserProfile[], onReply: (reviewId: string, reply: string) => void }) {
  const [replyingTo, setReplyingTo] = useState<string | null>(null);
  const [replyText, setReplyText] = useState('');

  const myReviews = reviews.filter(r => r.vendorId === vendor.id).sort((a, b) => b.timestamp - a.timestamp);
  const avgRating = myReviews.length > 0 ? (myReviews.reduce((acc, r) => acc + r.rating, 0) / myReviews.length).toFixed(1) : 0;

  return (
    <div className="bg-black min-h-screen pb-24 font-sans text-gray-200">
      <div className="bg-gray-950 px-6 pt-12 pb-6 border-b border-gray-900 sticky top-0 z-20">
        <h1 className="text-2xl font-bold tracking-tight text-white mb-1">Reviews & Ratings</h1>
        <div className="flex items-center space-x-2 text-sm text-gray-400">
           <Star size={16} className="text-yellow-500 fill-yellow-500" />
           <span className="font-bold text-white">{avgRating}</span>
           <span>({myReviews.length} reviews)</span>
        </div>
      </div>

      <div className="p-6 space-y-6">
        {myReviews.length === 0 ? (
          <div className="text-center py-20 text-gray-500">
            <Star size={48} className="mx-auto mb-4 opacity-20" />
            <p>No reviews yet.</p>
          </div>
        ) : (
          myReviews.map(review => {
            const user = users.find(u => u.id === review.userId);
            return (
              <div key={review.id} className="bg-gray-900 rounded-2xl p-5 border border-gray-800">
                <div className="flex justify-between items-start mb-3">
                  <div className="flex items-center space-x-3">
                    <div className="w-10 h-10 rounded-full bg-gray-800 overflow-hidden flex items-center justify-center shrink-0">
                      {user?.profilePic ? <img src={user.profilePic} alt="p" className="w-full h-full object-cover" /> : <User size={16} className="text-gray-500" />}
                    </div>
                    <div>
                      <div className="font-bold text-white">{user?.name || 'Anonymous User'}</div>
                      <div className="text-xs text-gray-500">{new Date(review.timestamp).toLocaleDateString()}</div>
                    </div>
                  </div>
                  <div className="flex text-yellow-500">
                    {[...Array(5)].map((_, i) => (
                      <Star key={i} size={14} className={i < review.rating ? "fill-yellow-500" : "text-gray-700"} />
                    ))}
                  </div>
                </div>
                <p className="text-sm text-gray-300 mb-4">{review.comment}</p>
                
                {review.reply ? (
                  <div className="bg-gray-950 p-4 rounded-xl border border-gray-800 ml-4 relative">
                     <div className="absolute -left-[17px] top-4 w-4 border-t border-l border-gray-800 rounded-tl-xl h-4"></div>
                     <p className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-1">Your Reply</p>
                     <p className="text-sm text-gray-300">{review.reply}</p>
                  </div>
                ) : (
                  <div className="mt-2 text-right">
                    {replyingTo === review.id ? (
                      <div className="bg-gray-950 p-3 rounded-xl border border-gray-800 mb-2">
                        <textarea 
                          className="w-full bg-transparent border-none text-sm text-white focus:ring-0 resize-none h-16 outline-none"
                          placeholder="Write a public reply..."
                          value={replyText}
                          onChange={e => setReplyText(e.target.value)}
                          autoFocus
                        />
                        <div className="flex justify-end space-x-2 mt-2">
                          <button onClick={() => setReplyingTo(null)} className="text-xs text-gray-400 px-3 py-1.5 hover:text-white transition-colors">Cancel</button>
                          <button onClick={() => { onReply(review.id, replyText); setReplyingTo(null); setReplyText(''); }} disabled={!replyText.trim()} className="text-xs bg-teal-600 hover:bg-teal-500 disabled:opacity-50 text-white font-bold px-4 py-1.5 rounded-lg transition-colors">Reply</button>
                        </div>
                      </div>
                    ) : (
                      <button onClick={() => { setReplyingTo(review.id); setReplyText(''); }} className="text-sm text-teal-500 hover:text-teal-400 font-medium transition-colors">
                        Reply
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

// 7. Super Admin Panel
function AdminDashboard({ users, bookings, chats, onLogout, onUpdateUser, onDeleteUser, onAddUser }: { users: UserProfile[], bookings: Booking[], chats: Message[], onLogout: () => void, onUpdateUser: (id: string, updates: Partial<UserProfile>) => void, onDeleteUser: (id: string) => void, onAddUser?: (email: string, phone: string, pass: string, role: string) => Promise<void> }) {
  const [adminView, setAdminView] = useState<'overview' | 'users' | 'providers' | 'bookings' | 'verifications'>('overview');
  const [selectedChatPair, setSelectedChatPair] = useState<{u1: string, u2: string} | null>(null);
  
  const [showAddUser, setShowAddUser] = useState(false);
  const [addUserForm, setAddUserForm] = useState({ email: '', phone: '', pass: '', role: 'user' });
  const [addingUser, setAddingUser] = useState(false);
  
  const chatPairs = React.useMemo(() => {
    const pairs = new Map<string, {u1: UserProfile, u2: UserProfile, lastMsg: number}>();
    chats.forEach(c => {
      const keys = [c.senderId, c.receiverId].sort();
      const key = keys.join('_');
      const u1 = users.find(u => u.id === keys[0]);
      const u2 = users.find(u => u.id === keys[1]);
      if (u1 && u2 && (!pairs.has(key) || pairs.get(key)!.lastMsg < c.timestamp)) {
         pairs.set(key, { u1, u2, lastMsg: c.timestamp });
      }
    });
    return Array.from(pairs.values()).sort((a,b) => b.lastMsg - a.lastMsg);
  }, [chats, users]);

  const pairMessages = selectedChatPair ? chats.filter(c => 
    (c.senderId === selectedChatPair.u1 && c.receiverId === selectedChatPair.u2) ||
    (c.senderId === selectedChatPair.u2 && c.receiverId === selectedChatPair.u1)
  ).sort((a,b) => a.timestamp - b.timestamp) : [];

  const stats = [
    { label: 'Total Users', value: users.filter(u => u.role === 'user').length, icon: <Users size={20} /> },
    { label: 'Service Providers', value: users.filter(u => u.role === 'vendor').length, icon: <Star size={20} /> },
    { label: 'Total Bookings', value: bookings.length + 15, icon: <TrendingUp size={20} /> }, // Mock data boost
    { label: 'Active Messages', value: chats.length, icon: <MessageCircle size={20} /> },
  ];

  return (
    <div className="bg-[#050505] min-h-screen p-6 font-sans text-gray-200">
      <div className="max-w-6xl mx-auto flex flex-col pt-6">
        <header className="flex justify-between items-center mb-10 pb-6 border-b border-gray-800">
          <div>
            <h1 className="text-3xl font-black text-white uppercase tracking-tighter">HITSHIGH <span className="font-light text-red-500">Overwatch</span></h1>
            <p className="text-gray-500 text-sm font-mono mt-1">Super Administrator Console</p>
          </div>
          <button onClick={onLogout} className="text-xs bg-red-900/30 text-red-400 px-4 py-2 border border-red-900/50 hover:bg-red-900/50 uppercase tracking-widest font-mono transition-colors">Terminate Session</button>
        </header>

        {/* Analytics Grid */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
          {stats.map((stat, i) => (
            <div key={i} className="bg-[#0a0a0a] border border-[#1a1a1a] p-6 flex flex-col justify-between">
              <div className="flex justify-between items-start mb-4 text-[#404040]">
                <span className="text-xs uppercase tracking-widest font-mono">{stat.label}</span>
                {stat.icon}
              </div>
              <span className="text-5xl font-light text-white">{stat.value}</span>
            </div>
          ))}
        </div>

        {/* Navigation Tabs */}
        <div className="flex space-x-4 border-b border-gray-800 mb-6 overflow-x-auto no-scrollbar">
           <button onClick={() => setAdminView('overview')} className={`pb-3 whitespace-nowrap uppercase tracking-widest text-xs font-bold ${adminView === 'overview' ? 'text-teal-400 border-b-2 border-teal-500' : 'text-gray-500 hover:text-white'}`}>Overview</button>
           <button onClick={() => setAdminView('users')} className={`pb-3 whitespace-nowrap uppercase tracking-widest text-xs font-bold ${adminView === 'users' ? 'text-teal-400 border-b-2 border-teal-500' : 'text-gray-500 hover:text-white'}`}>Manage Users</button>
           <button onClick={() => setAdminView('providers')} className={`pb-3 whitespace-nowrap uppercase tracking-widest text-xs font-bold ${adminView === 'providers' ? 'text-teal-400 border-b-2 border-teal-500' : 'text-gray-500 hover:text-white'}`}>Manage Providers</button>
           <button onClick={() => setAdminView('bookings')} className={`pb-3 whitespace-nowrap uppercase tracking-widest text-xs font-bold ${adminView === 'bookings' ? 'text-teal-400 border-b-2 border-teal-500' : 'text-gray-500 hover:text-white'}`}>All Bookings</button>
           <button onClick={() => setAdminView('verifications')} className={`pb-3 whitespace-nowrap uppercase tracking-widest text-xs font-bold ${adminView === 'verifications' ? 'text-teal-400 border-b-2 border-teal-500' : 'text-gray-500 hover:text-white'}`}>Verification Requests</button>
        </div>

        {/* Management Area */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-6">
            {adminView === 'overview' && (
              <div className="grid grid-cols-2 gap-4 h-min">
                 <button onClick={() => setAdminView('users')} className="bg-[#0a0a0a] border border-[#1a1a1a] p-12 hover:bg-[#111] transition-colors flex flex-col items-center justify-center text-center group rounded-xl">
                    <Users size={32} className="text-gray-500 mb-4 group-hover:text-teal-400 transition-colors" />
                    <span className="uppercase font-mono font-bold tracking-widest text-gray-400 group-hover:text-white">Manage Users</span>
                 </button>
                 <button onClick={() => setAdminView('providers')} className="bg-[#0a0a0a] border border-[#1a1a1a] p-12 hover:bg-[#111] transition-colors flex flex-col items-center justify-center text-center group rounded-xl">
                    <Star size={32} className="text-gray-500 mb-4 group-hover:text-teal-400 transition-colors" />
                    <span className="uppercase font-mono font-bold tracking-widest text-gray-400 group-hover:text-white">Manage Providers</span>
                 </button>
              </div>
            )}

            {(adminView === 'users' || adminView === 'providers') && (
              <div className="bg-[#0a0a0a] border border-[#1a1a1a] overflow-hidden">
                <div className="p-4 border-b border-[#1a1a1a] bg-[#0d0d0d] flex justify-between items-center">
                  <h3 className="text-sm font-bold uppercase tracking-widest text-[#a0a0a0]">{adminView === 'users' ? 'User Directory' : 'Service Provider Directory'}</h3>
                  <button onClick={() => { setAddUserForm({ ...addUserForm, role: adminView === 'users' ? 'user' : 'vendor' }); setShowAddUser(true); }} className="text-xs bg-teal-900/30 text-teal-400 px-3 py-1.5 border border-teal-900/50 hover:bg-teal-900/50 uppercase tracking-widest font-mono transition-colors rounded">Add {adminView === 'users' ? 'User' : 'Provider'}</button>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm text-gray-400">
                    <thead className="text-xs bg-[#050505] uppercase border-b border-[#1a1a1a] font-mono">
                      <tr>
                        <th className="px-4 py-3">Profile</th>
                        <th className="px-4 py-3">Contact</th>
                        {adminView === 'providers' && <th className="px-4 py-3">Verification</th>}
                        <th className="px-4 py-3">Status</th>
                        <th className="px-4 py-3 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#1a1a1a]">
                      {users.filter(u => u.role !== 'admin' && (adminView === 'users' ? u.role === 'user' : u.role === 'vendor')).map((u) => (
                        <tr key={u.id} className="hover:bg-[#111111] transition-colors">
                          <td className="px-4 py-4 font-medium text-white flex items-center gap-3">
                             {u.profilePic ? <img src={u.profilePic} className="w-8 h-8 rounded-full object-cover" /> : <div className="w-8 h-8 rounded-full bg-gray-800 flex items-center justify-center"><User size={14}/></div>}
                             {u.name}
                          </td>
                          <td className="px-4 py-4">{u.email || u.phone || 'N/A'}</td>
                          {adminView === 'providers' && (
                            <td className="px-4 py-4">
                               {u.verificationStatus === 'pending' && <span className="bg-yellow-900/30 text-yellow-500 px-2 py-1 text-[10px] uppercase border border-yellow-900/50 rounded-sm">Pending</span>}
                               {u.verificationStatus === 'approved' && <span className="bg-blue-900/30 text-blue-500 px-2 py-1 text-[10px] uppercase border border-blue-900/50 rounded-sm">Verified</span>}
                               {u.verificationStatus === 'rejected' && <span className="bg-red-900/30 text-red-500 px-2 py-1 text-[10px] uppercase border border-red-900/50 rounded-sm">Rejected</span>}
                               {(!u.verificationStatus || u.verificationStatus === 'none') && <span className="text-gray-500 text-[10px] uppercase">None</span>}
                            </td>
                          )}
                          <td className="px-4 py-4">
                             {u.isRedFlagged && <span className="bg-red-900/30 text-red-500 px-2 py-1 text-[10px] uppercase border border-red-900/50 mr-2 rounded-sm">Flagged</span>}
                             {u.isBlocked && <span className="bg-orange-900/30 text-orange-500 px-2 py-1 text-[10px] uppercase border border-orange-900/50 mr-2 rounded-sm">Blocked</span>}
                             {!u.isRedFlagged && !u.isBlocked && <span className="text-teal-500 text-[10px] uppercase">Active</span>}
                          </td>
                          <td className="px-4 py-4 text-right">
                            <div className="flex items-center justify-end gap-2">
                              {adminView === 'providers' && u.verificationStatus === 'pending' && (
                                <>
                                  <button onClick={() => onUpdateUser(u.id, { verificationStatus: 'approved' })} className="p-2 border border-[#222222] rounded-md text-blue-500 hover:bg-blue-900/20 hover:border-blue-500 transition-colors" title="Approve Verification">
                                    <CheckCircle size={16} />
                                  </button>
                                  <button onClick={() => onUpdateUser(u.id, { verificationStatus: 'rejected' })} className="p-2 border border-[#222222] rounded-md text-red-500 hover:bg-red-900/20 hover:border-red-500 transition-colors" title="Reject Verification">
                                    <X size={16} />
                                  </button>
                                </>
                              )}
                              <button 
                                onClick={() => onUpdateUser(u.id, { isBlocked: !u.isBlocked })}
                                className={`p-2 border rounded-md transition-colors ${u.isBlocked ? 'bg-orange-500/10 border-orange-500/50 text-orange-500 hover:bg-orange-500/20' : 'border-[#222222] text-gray-500 hover:text-orange-500 hover:border-orange-500/50'}`}
                                title={u.isBlocked ? "Unblock Account" : "Block Account"}
                              >
                                <ShieldAlert size={16} />
                              </button>
                              <button 
                                onClick={() => onUpdateUser(u.id, { isRedFlagged: !u.isRedFlagged })}
                                className={`p-2 border rounded-md transition-colors ${u.isRedFlagged ? 'bg-red-500/10 border-red-500/50 text-red-500 hover:bg-red-500/20' : 'border-[#222222] text-gray-500 hover:text-red-500 hover:border-red-500/50'}`}
                                title={u.isRedFlagged ? "Remove Red Flag" : "Assign Red Flag"}
                              >
                                <Flag size={16} className={u.isRedFlagged ? 'fill-current' : ''} />
                              </button>
                              <button 
                                onClick={() => { if(confirm('Are you sure you want to permanently delete this account?')) onDeleteUser(u.id) }}
                                className="p-2 border border-[#222222] rounded-md text-red-600 hover:bg-red-900/20 hover:border-red-600 transition-colors"
                                title="Delete Account"
                              >
                                <X size={16} />
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                      {users.filter(u => u.role !== 'admin' && (adminView === 'users' ? u.role === 'user' : u.role === 'vendor')).length === 0 && (
                        <tr>
                          <td colSpan={adminView === 'providers' ? 5 : 4} className="px-4 py-8 text-center text-gray-500 italic text-sm">No items found</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {adminView === 'verifications' && (
              <div className="bg-[#0a0a0a] border border-[#1a1a1a] overflow-hidden">
                <div className="p-4 border-b border-[#1a1a1a] bg-[#0d0d0d]">
                  <h3 className="text-sm font-bold uppercase tracking-widest text-[#a0a0a0]">Verification Requests</h3>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm text-gray-400">
                    <thead className="text-xs bg-[#050505] uppercase border-b border-[#1a1a1a] font-mono">
                      <tr>
                        <th className="px-4 py-3">Provider</th>
                        <th className="px-4 py-3">Status</th>
                        <th className="px-4 py-3 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#1a1a1a]">
                      {users.filter(u => u.role === 'vendor' && (u.verificationStatus === 'pending' || u.verificationStatus === 'approved' || u.verificationStatus === 'rejected')).map((u) => (
                        <tr key={u.id} className="hover:bg-[#111111] transition-colors">
                          <td className="px-4 py-4 font-medium text-white flex items-center gap-3">
                             {u.profilePic ? <img src={u.profilePic} className="w-8 h-8 rounded-full object-cover" /> : <div className="w-8 h-8 rounded-full bg-gray-800 flex items-center justify-center"><User size={14}/></div>}
                             {u.name}
                          </td>
                          <td className="px-4 py-4">
                             {u.verificationStatus === 'pending' && <span className="bg-yellow-900/30 text-yellow-500 px-2 py-1 text-[10px] uppercase border border-yellow-900/50 rounded-sm">Pending</span>}
                             {u.verificationStatus === 'approved' && <span className="bg-blue-900/30 text-blue-500 px-2 py-1 text-[10px] uppercase border border-blue-900/50 rounded-sm">Verified</span>}
                             {u.verificationStatus === 'rejected' && <span className="bg-red-900/30 text-red-500 px-2 py-1 text-[10px] uppercase border border-red-900/50 rounded-sm">Rejected</span>}
                          </td>
                          <td className="px-4 py-4 text-right">
                            <div className="flex items-center justify-end gap-2">
                              {u.verificationStatus === 'pending' && (
                                <>
                                  <button onClick={() => onUpdateUser(u.id, { verificationStatus: 'approved' })} className="p-2 border border-[#222222] rounded-md text-blue-500 hover:bg-blue-900/20 hover:border-blue-500 transition-colors" title="Approve Verification">
                                    <CheckCircle size={16} />
                                  </button>
                                  <button onClick={() => onUpdateUser(u.id, { verificationStatus: 'rejected' })} className="p-2 border border-[#222222] rounded-md text-red-500 hover:bg-red-900/20 hover:border-red-500 transition-colors" title="Reject Verification">
                                    <X size={16} />
                                  </button>
                                </>
                              )}
                              {u.verificationStatus === 'approved' && (
                                 <button onClick={() => onUpdateUser(u.id, { verificationStatus: 'none' })} className="p-2 border border-[#222222] rounded-md text-red-500 hover:bg-red-900/20 hover:border-red-500 transition-colors" title="Revoke Verification">
                                    Revoke
                                  </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))}
                      {users.filter(u => u.role === 'vendor' && (u.verificationStatus === 'pending' || u.verificationStatus === 'approved' || u.verificationStatus === 'rejected')).length === 0 && (
                        <tr>
                          <td colSpan={3} className="px-4 py-8 text-center text-gray-500 italic text-sm">No verification requests found</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {adminView === 'bookings' && (
              <div className="bg-[#0a0a0a] border border-[#1a1a1a] overflow-hidden">
                <div className="p-4 border-b border-[#1a1a1a] bg-[#0d0d0d]">
                  <h3 className="text-sm font-bold uppercase tracking-widest text-[#a0a0a0]">All Bookings Log</h3>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm text-gray-400">
                    <thead className="text-xs bg-[#050505] uppercase border-b border-[#1a1a1a] font-mono">
                      <tr>
                        <th className="px-4 py-3">Details</th>
                        <th className="px-4 py-3">Event Date</th>
                        <th className="px-4 py-3">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#1a1a1a]">
                      {bookings.map((b) => {
                         const user = users.find(u => u.id === b.userId);
                         const vendor = users.find(u => u.id === b.vendorId);
                         return (
                           <tr key={b.id} className="hover:bg-[#111111] transition-colors">
                             <td className="px-4 py-4">
                                <div className="text-white font-medium">{user?.name || 'Unknown User'} <span className="text-gray-500 font-normal">booked</span> {vendor?.name || 'Unknown Provider'}</div>
                                <div className="text-xs text-gray-500 mt-1 uppercase tracking-widest font-mono">Service: {b.type} • Pkg: {b.package}</div>
                             </td>
                             <td className="px-4 py-4">{new Date(b.date).toLocaleDateString()}</td>
                             <td className="px-4 py-4">
                                {b.status === 'pending' && <span className="bg-yellow-900/30 text-yellow-500 px-2 py-1 text-[10px] uppercase border border-yellow-900/50 rounded-sm">Pending</span>}
                                {b.status === 'confirmed' && <span className="bg-teal-900/30 text-teal-500 px-2 py-1 text-[10px] uppercase border border-teal-900/50 rounded-sm">Accepted</span>}
                                {b.status === 'completed' && <span className="bg-gray-900 text-white px-2 py-1 text-[10px] uppercase border border-gray-700 rounded-sm">Completed</span>}
                                {b.status === 'rejected' && <span className="bg-red-900/30 text-red-500 px-2 py-1 text-[10px] uppercase border border-red-900/50 rounded-sm">Rejected</span>}
                             </td>
                           </tr>
                         )
                      })}
                      {bookings.length === 0 && (
                        <tr>
                          <td colSpan={3} className="px-4 py-8 text-center text-gray-500 italic text-sm">No bookings logged</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>

          <div>
             <div className="bg-[#0a0a0a] border border-[#1a1a1a] h-full flex flex-col">
              <div className="p-4 border-b border-[#1a1a1a] bg-[#0d0d0d] flex justify-between items-center gap-2">
                <h3 className="text-sm font-bold uppercase tracking-widest text-red-500 flex items-center gap-2">
                  <ShieldAlert size={16} /> Chat Surveillance
                </h3>
                {selectedChatPair && (
                   <button onClick={() => setSelectedChatPair(null)} className="text-xs text-gray-400 hover:text-white flex items-center gap-1 bg-[#1a1a1a] px-2 py-1 rounded transition-colors border border-[#333]">
                     <ChevronRight size={14} className="rotate-180" /> Back to list
                   </button>
                )}
              </div>
              <div className="p-0 flex-1 overflow-y-auto max-h-[600px] font-sans">
                {!selectedChatPair ? (
                   <div className="divide-y divide-[#1a1a1a]">
                     {chatPairs.length === 0 ? (
                       <p className="p-4 text-gray-600 italic font-mono text-xs">No communications logged.</p>
                     ) : (
                       chatPairs.map((pair, i) => (
                         <div key={i} onClick={() => setSelectedChatPair({u1: pair.u1.id, u2: pair.u2.id})} className="p-4 hover:bg-[#111] cursor-pointer transition-colors flex items-center justify-between group">
                            <div>
                               <div className="text-sm text-gray-200 font-bold">{pair.u1.name} <span className="text-gray-600 font-normal mx-1">↔</span> {pair.u2.name}</div>
                               <div className="text-xs text-gray-500 mt-1 uppercase tracking-widest font-mono">Last activity: {new Date(pair.lastMsg).toLocaleDateString()}</div>
                            </div>
                            <ChevronRight size={16} className="text-gray-600 group-hover:text-teal-500 transition-colors" />
                         </div>
                       ))
                     )}
                   </div>
                ) : (
                   <div className="p-4 space-y-4">
                     <div className="text-center font-mono text-xs text-red-500 mb-6 border-b border-red-900/30 pb-4 tracking-widest uppercase">
                        MONITORING ACTIVE SESSION
                     </div>
                     {pairMessages.map((m) => {
                       const sender = users.find(u => u.id === m.senderId);
                       const isU1 = m.senderId === selectedChatPair.u1;
                       return (
                         <div key={m.id} className={`flex flex-col ${isU1 ? 'items-start' : 'items-end'}`}>
                            <span className="text-[10px] text-gray-500 font-mono mb-1">{sender?.name} - {new Date(m.timestamp).toLocaleTimeString()}</span>
                            <div className={`max-w-[80%] rounded-xl px-3 py-2 text-sm ${isU1 ? 'bg-[#1a1a1a] text-gray-200' : 'bg-[#0f2922] text-teal-100'}`}>
                              {m.imageUrl && <img src={m.imageUrl} alt="attachment" className="max-w-full rounded-lg mb-2 border border-gray-700/50" />}
                              {m.isAudio && (
                                <div className="flex items-center gap-2 opacity-80">
                                  <Play size={14} /> <span className="text-xs font-mono">{m.audioDuration}s audio</span>
                                </div>
                              )}
                              {m.text && <p>{m.text}</p>}
                            </div>
                         </div>
                       )
                     })}
                   </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
      {showAddUser && onAddUser && (
        <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4">
          <div className="bg-[#0a0a0a] border border-[#1a1a1a] p-6 max-w-sm w-full font-sans">
            <h3 className="text-xl font-bold text-white uppercase tracking-tighter mb-6">Add {adminView === 'users' ? 'User' : 'Vendor'}</h3>
            <div className="space-y-4">
               <div>
                  <label className="text-xs font-bold uppercase tracking-widest text-gray-500 mb-1 block">Email</label>
                  <input type="email" value={addUserForm.email} onChange={e => setAddUserForm({...addUserForm, email: e.target.value})} className="w-full bg-[#111] border border-[#222] p-2 text-white outline-none focus:border-teal-500" />
               </div>
               <div>
                  <label className="text-xs font-bold uppercase tracking-widest text-gray-500 mb-1 block">Phone</label>
                  <input type="text" value={addUserForm.phone} onChange={e => setAddUserForm({...addUserForm, phone: e.target.value})} className="w-full bg-[#111] border border-[#222] p-2 text-white outline-none focus:border-teal-500" />
               </div>
               <div>
                  <label className="text-xs font-bold uppercase tracking-widest text-gray-500 mb-1 block">Password</label>
                  <input type="password" value={addUserForm.pass} onChange={e => setAddUserForm({...addUserForm, pass: e.target.value})} className="w-full bg-[#111] border border-[#222] p-2 text-white outline-none focus:border-teal-500" />
               </div>
               <div className="flex gap-2 justify-end mt-6">
                 <button onClick={() => setShowAddUser(false)} className="px-4 py-2 text-sm text-gray-500 hover:text-white uppercase tracking-widest font-mono">Cancel</button>
                 <button disabled={addingUser || !addUserForm.pass} onClick={async () => {
                    setAddingUser(true);
                    await onAddUser(addUserForm.email, addUserForm.phone, addUserForm.pass, addUserForm.role);
                    setAddingUser(false);
                    setShowAddUser(false);
                    setAddUserForm({ email: '', phone: '', pass: '', role: 'user' });
                 }} className="px-4 py-2 bg-teal-900/30 text-teal-400 border border-teal-900/50 hover:bg-teal-900/50 text-sm uppercase tracking-widest font-mono disabled:opacity-50">Save</button>
               </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}


// Bottom Navigation (Uber style)
function BottomNav({ role, activeTab, onSelect }: { role: string | undefined, activeTab: string, onSelect: (t: any) => void }) {
  const tabs = [
    { id: 'home', icon: <Home size={22} />, label: 'Home' },
    { id: 'bookings', icon: <Calendar size={22} />, label: 'Activity' },
    { id: 'messages', icon: <MessageCircle size={22} />, label: 'Messages' },
    ...(role === 'vendor' ? [{ id: 'reviews', icon: <Star size={22} />, label: 'Reviews' }] : []),
    { id: 'account', icon: <User size={22} />, label: 'Account' },
  ];

  return (
    <div className="fixed bottom-0 w-full max-w-md lg:max-w-full mx-auto inset-x-0 bg-gray-950/90 backdrop-blur-xl border-t border-gray-900 pb-safe pt-2 z-40">
      <div className="flex justify-between items-center px-6 lg:max-w-md lg:mx-auto">
        {tabs.map(t => {
          const active = activeTab === t.id;
          return (
            <button 
              key={t.id} 
              onClick={() => onSelect(t.id)} 
              className="flex flex-col items-center p-2 relative w-16"
            >
              <div className={`transition-all duration-300 ${active ? 'text-white translate-y-0' : 'text-gray-500 hover:text-gray-300 translate-y-1'}`}>
                {t.icon}
              </div>
              <span className={`text-[10px] font-medium mt-1 transition-all duration-300 ${active ? 'text-white opacity-100' : 'text-gray-500 opacity-0'}`}>
                {t.label}
              </span>
              {active && (
                <motion.div layoutId="navIndicator" className="absolute top-0 w-8 h-1 bg-teal-500 rounded-b-full shadow-[0_0_10px_rgba(20,184,166,0.8)]" />
              )}
            </button>
          )
        })}
      </div>
      {/* iOS safe area padding handled via CSS if needed, adding simple pb */}
      <div className="pb-4 sm:pb-2"></div>
    </div>
  );
}

