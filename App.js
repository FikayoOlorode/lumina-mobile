import React, { useState, useEffect } from 'react';
import { StyleSheet, Text, View, FlatList, TouchableOpacity, SafeAreaView } from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import * as Linking from 'expo-linking';
import * as QueryParams from 'expo-auth-session/build/QueryParams';
import { supabase } from './lib/supabase';

// Required so the browser closes automatically after Google auth
WebBrowser.maybeCompleteAuthSession();

export default function App() {
  const [session, setSession] = useState(null);
  const [cart, setCart] = useState([]);

  // 1. Maintain Login Session
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
    });

    return () => subscription.unsubscribe();
  }, []);

  // 2. Fetch Initial Cart and Listen for Live Web Updates
  useEffect(() => {
    if (!session?.user) {
      setCart([]);
      return;
    }

    const fetchCart = async () => {
      const { data } = await supabase
        .from('cart_items')
        .select('*')
        .eq('user_id', session.user.id);
      if (data) setCart(data);
    };

    fetchCart();

    // Supabase Realtime WebSocket connection
    const channel = supabase
      .channel('cart_sync')
      .on('postgres_changes', {
          event: '*',
          schema: 'public',
          table: 'cart_items',
          filter: `user_id=eq.${session.user.id}`,
        },
        (payload) => {
          if (payload.eventType === 'INSERT') setCart((prev) => [...prev, payload.new]);
          else if (payload.eventType === 'UPDATE') setCart((prev) => prev.map((item) => (item.id === payload.new.id ? payload.new : item)));
          else if (payload.eventType === 'DELETE') setCart((prev) => prev.filter((item) => item.id === payload.old.id));
        }
      )
      .subscribe();

    return () => supabase.removeChannel(channel);
  }, [session]);

  // 3. Handle Google OAuth via Mobile Browser
  const handleGoogleLogin = async () => {
    const redirectUrl = Linking.createURL(''); // Gets your local Expo Go URL

    // Get the Google login URL from Supabase
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: redirectUrl,
        skipBrowserRedirect: true, 
      },
    });

    if (error) return alert(error.message);

    // Open the Google login page
    const result = await WebBrowser.openAuthSessionAsync(data.url, redirectUrl);

    // Catch the redirect back to the app and extract the session token
    if (result.type === 'success') {
      const { params, errorCode } = QueryParams.getQueryParams(result.url);
      if (errorCode) throw new Error(errorCode);
      
      const { access_token, refresh_token } = params;
      if (access_token) {
        await supabase.auth.setSession({ access_token, refresh_token });
      }
    }
  };

  // RENDER: Login Screen
  if (!session) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.loginWrapper}>
          <Text style={styles.title}>Lumina Mobile</Text>
          <TouchableOpacity style={styles.googleButton} onPress={handleGoogleLogin}>
            <Text style={styles.googleButtonText}>Sign in with Google</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  // RENDER: Active Cart Screen
  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Synced Cart</Text>
        <TouchableOpacity onPress={() => supabase.auth.signOut()}>
          <Text style={styles.logoutText}>Sign Out</Text>
        </TouchableOpacity>
      </View>
      
      <FlatList
        data={cart}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <View style={styles.cartItem}>
            <Text style={styles.itemName}>{item.title}</Text>
            <Text style={styles.itemMeta}>Qty: {item.quantity}  |  ₦{item.price}</Text>
          </View>
        )}
        ListEmptyComponent={<Text style={styles.emptyText}>Your cart is empty.</Text>}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f9fafb' },
  loginWrapper: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 24, borderBottomWidth: 1, borderColor: '#e5e7eb', backgroundColor: '#fff' },
  title: { fontSize: 24, fontWeight: 'bold', color: '#111', marginBottom: 24 },
  googleButton: { backgroundColor: '#4285F4', paddingVertical: 14, paddingHorizontal: 32, borderRadius: 8, width: '100%', alignItems: 'center' },
  googleButtonText: { color: '#fff', fontWeight: 'bold', fontSize: 16 },
  cartItem: { padding: 20, borderBottomWidth: 1, borderColor: '#e5e7eb', backgroundColor: '#fff' },
  itemName: { fontSize: 18, fontWeight: '600', color: '#111' },
  itemMeta: { color: '#4b5563', marginTop: 8, fontSize: 16 },
  logoutText: { color: '#ef4444', fontWeight: '600', fontSize: 16 },
  emptyText: { padding: 24, textAlign: 'center', color: '#6b7280', fontSize: 16 }
});