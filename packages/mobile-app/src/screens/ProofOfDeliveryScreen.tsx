import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Platform,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  type TextStyle,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import type { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import { apiFetch, ApiError, NetworkError } from '../api';
import { formatTimeHuman } from '../format';
import { Icon } from '../components/Icon';
import { colors, radii, spacing, typography } from '../theme';
import type { TransportJobDetail } from '../types';
import type { DriverTabParamList } from '../navigation/DriverTabNavigator';

interface PickedPhoto {
  uri: string;
  mimeType: string;
  name: string;
}

type Props = BottomTabScreenProps<DriverTabParamList, 'SafariProofOfDelivery'>;

/**
 * Stage DM15 - mockup screen 9 ("Proof of delivery"). Several things the
 * mockup shows are deliberately NOT built this stage, decided ahead of
 * time: no signature capture (no signature-drawing component exists
 * anywhere in this codebase yet); no "GPS confirmed · Nm from target"
 * distance claim (TransportJob has no destination coordinates to compute
 * one from - the driver's real last known position and when it was
 * recorded is shown instead, nothing about distance to anything); no
 * "Salio la safari" trip-balance card (its figure is derived from revenue,
 * which stays owner-only per DM12); no invoice/owner-notification footer
 * (no Invoice model, no notification hook for a job being delivered).
 *
 * Own independent GET /transport-jobs/:id load, same pattern every other
 * screen here already uses - not fed from SafariJobDetailScreen's state,
 * since this is reached via navigation.navigate() with just a jobId.
 *
 * No offline queue for the complete-job action this stage (a deliberate
 * simplification, not an oversight): unlike expenses/payments, proof of
 * delivery is a synchronous, in-the-moment action performed once at the
 * delivery point, not something that needs to survive being offline for
 * days. A network failure here just leaves the button re-enabled to retry.
 */
export function ProofOfDeliveryScreen({ route, navigation }: Props) {
  const { jobId } = route.params;
  const [job, setJob] = useState<TransportJobDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [photo, setPhoto] = useState<PickedPhoto | null>(null);
  const [completing, setCompleting] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const detail = await apiFetch<TransportJobDetail>(`/transport-jobs/${jobId}`);
      setJob(detail);
    } catch (err) {
      if (err instanceof NetworkError) {
        setError('Cannot reach the server. Check your connection.');
      } else if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError('Something went wrong. Please try again.');
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [jobId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleTakePhoto() {
    if (Platform.OS !== 'web') {
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (!perm.granted) {
        setError('Allow camera access to photograph the cargo.');
        return;
      }
    }
    // launchCameraAsync, not the photo-library picker MatumiziScreen uses
    // for expense receipts - proof of delivery is taken in the moment.
    const result = await ImagePicker.launchCameraAsync({ quality: 0.7 });
    if (result.canceled || !result.assets?.length) return;
    const asset = result.assets[0];
    setPhoto({
      uri: asset.uri,
      mimeType: asset.mimeType ?? 'image/jpeg',
      name: asset.fileName ?? `delivery-${Date.now()}.jpg`,
    });
  }

  async function handleComplete() {
    if (!photo) return;
    setError(null);
    setCompleting(true);
    try {
      // Same web-vs-native FormData construction expenseQueue.ts's
      // tryUploadReceipt already uses for receipt uploads.
      const form = new FormData();
      if (Platform.OS === 'web') {
        const blob = await (await fetch(photo.uri)).blob();
        form.append('file', blob, photo.name);
      } else {
        form.append('file', {
          uri: photo.uri,
          name: photo.name,
          type: photo.mimeType,
        } as unknown as Blob);
      }
      await apiFetch(`/transport-jobs/${jobId}/delivery-photo`, { method: 'POST', body: form });
      await apiFetch(`/transport-jobs/${jobId}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status: 'DELIVERED' }),
      });
      navigation.navigate('Today');
    } catch (err) {
      if (err instanceof NetworkError) {
        setError('Cannot reach the server. Check your connection and try again.');
      } else if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError('Something went wrong. Please try again.');
      }
      setCompleting(false);
    }
  }

  if (loading) {
    return (
      <View style={[styles.container, styles.center]}>
        <ActivityIndicator size="large" color={colors.green} />
      </View>
    );
  }

  const canComplete = Boolean(photo) && !completing;

  return (
    <View style={styles.container}>
      <View style={styles.appbar}>
        <TouchableOpacity
          style={styles.iconButton}
          onPress={() => navigation.navigate('SafariDetail', { jobId })}
        >
          <Icon name="close" size={17} color={colors.txt2} />
        </TouchableOpacity>
        <Text style={styles.appbarTitle}>Thibitisha kufika</Text>
      </View>

      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              void load();
            }}
            tintColor={colors.green}
          />
        }
      >
        {error && (
          <View style={styles.errorBanner}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        )}

        {job && (
          <>
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Nafasi ya mwisho</Text>
              {job.progress.lastPosition ? (
                <Text style={styles.positionText}>
                  Nafasi ya mwisho ilipokewa saa{' '}
                  {formatTimeHuman(job.progress.lastPosition.recordedAt)}
                </Text>
              ) : (
                <Text style={styles.positionEmpty}>No GPS position recorded yet.</Text>
              )}
            </View>

            <View style={styles.field}>
              <Text style={styles.fieldLabel}>Picha ya mzigo · Cargo photo</Text>
              <TouchableOpacity
                style={[styles.photoBox, photo && styles.photoBoxSelected]}
                onPress={() => void handleTakePhoto()}
              >
                {photo ? (
                  <Image source={{ uri: photo.uri }} style={styles.photoThumb} />
                ) : (
                  <>
                    <Icon name="camera" size={26} color={colors.txt3} />
                    <Text style={styles.photoText}>Piga picha ya mzigo</Text>
                    <Text style={styles.photoSubtext}>Photograph the cargo</Text>
                  </>
                )}
              </TouchableOpacity>
              {photo && (
                <TouchableOpacity onPress={() => void handleTakePhoto()}>
                  <Text style={styles.retakeText}>Piga tena · Retake photo</Text>
                </TouchableOpacity>
              )}
            </View>

            <TouchableOpacity
              style={[styles.completeButton, !photo && styles.completeButtonDisabled]}
              onPress={() => void handleComplete()}
              disabled={!canComplete}
            >
              {completing ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <>
                  <Icon name="check" size={19} color={photo ? '#fff' : colors.txt3} />
                  <Text
                    style={[styles.completeButtonText, !photo && styles.completeButtonTextDisabled]}
                  >
                    Maliza safari · Complete job
                  </Text>
                </>
              )}
            </TouchableOpacity>
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  center: { justifyContent: 'center', alignItems: 'center' },
  appbar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.xl,
    paddingTop: 56,
    paddingBottom: spacing.lg,
  },
  iconButton: {
    width: 34,
    height: 34,
    borderRadius: 11,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.line,
    alignItems: 'center',
    justifyContent: 'center',
  },
  appbarTitle: {
    color: colors.txt,
    fontSize: 17.5,
    fontWeight: '750' as TextStyle['fontWeight'],
    letterSpacing: -0.4,
  },
  content: { paddingHorizontal: spacing.xl, paddingBottom: 40 },
  errorBanner: {
    backgroundColor: colors.redSoft,
    borderRadius: 12,
    padding: 10,
    marginBottom: spacing.md,
  },
  errorText: { color: colors.red, textAlign: 'center', fontSize: 13 },
  card: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.lineSoft,
    borderRadius: radii.card,
    padding: 16,
    marginBottom: spacing.lg,
  },
  cardTitle: {
    color: colors.txt,
    fontSize: typography.cardTitle.fontSize,
    fontWeight: typography.cardTitle.fontWeight as TextStyle['fontWeight'],
    marginBottom: spacing.sm,
  },
  positionText: { color: colors.txt2, fontSize: 12.5, lineHeight: 18 },
  positionEmpty: { color: colors.txt3, fontSize: 12.5 },
  field: { marginBottom: spacing.lg },
  fieldLabel: {
    color: colors.txt3,
    fontSize: 11.5,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: spacing.sm,
  },
  photoBox: {
    backgroundColor: colors.card2,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: colors.line,
    borderRadius: 14,
    padding: 26,
    alignItems: 'center',
    overflow: 'hidden',
  },
  photoBoxSelected: { borderColor: colors.green, backgroundColor: colors.greenSoft, padding: 0 },
  photoThumb: { width: '100%', height: 200, borderRadius: 12.5 },
  photoText: {
    color: colors.txt3,
    fontSize: 12,
    fontWeight: '650' as TextStyle['fontWeight'],
    marginTop: 9,
    textAlign: 'center',
  },
  photoSubtext: { color: colors.txt3, fontSize: 10.5, fontWeight: '500', marginTop: 2 },
  retakeText: {
    color: colors.green,
    fontSize: 12,
    fontWeight: '650' as TextStyle['fontWeight'],
    textAlign: 'center',
    marginTop: spacing.sm,
  },
  completeButton: {
    backgroundColor: colors.green,
    borderRadius: radii.cta,
    paddingVertical: 17,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 9,
    marginBottom: spacing.lg,
  },
  // Visibly, not just inert-via-disabled: a muted card-colored fill and
  // muted icon/text (set inline above), same "amber/muted reads as not
  // actionable" language the rest of this app already uses.
  completeButtonDisabled: { backgroundColor: colors.card2 },
  completeButtonText: { color: '#fff', fontSize: 15.5, fontWeight: '800' },
  completeButtonTextDisabled: { color: colors.txt3 },
});
