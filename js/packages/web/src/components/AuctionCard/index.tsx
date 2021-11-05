import React, { useCallback, useMemo, useState } from 'react';
import { Col, Button, InputNumber, Spin } from 'antd';
import { MemoryRouter, Route, Redirect, Link } from 'react-router-dom';

import {
  useConnection,
  useUserAccounts,
  MetaplexModal,
  MetaplexOverlay,
  formatAmount,
  formatTokenAmount,
  useMint,
  PriceFloorType,
  AuctionDataExtended,
  ParsedAccount,
  getAuctionExtended,
  programIds,
  AuctionState,
  BidderMetadata,
  MAX_METADATA_LEN,
  MAX_EDITION_LEN,
  useWalletModal,
  VaultState,
  loadMultipleAccounts,
  BidStateType,
} from '@oyster/common';
import { useWallet } from '@solana/wallet-adapter-react';
import { AuctionView, useBidsForAuction, useUserBalance } from '../../hooks';
import { sendPlaceBid } from '../../actions/sendPlaceBid';
// import { bidAndClaimInstantSale } from '../../actions/bidAndClaimInstantSale';
import { AuctionNumbers } from './../AuctionNumbers';
import {
  sendRedeemBid,
  eligibleForParticipationPrizeGivenWinningIndex,
} from '../../actions/sendRedeemBid';
import { sendCancelBid } from '../../actions/cancelBid';
import { startAuctionManually } from '../../actions/startAuctionManually';
import BN from 'bn.js';
import { Confetti } from '../Confetti';
import { QUOTE_MINT } from '../../constants';
import { Connection, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { useMeta, useSolPrice } from '../../contexts';
import moment from 'moment';
import { AccountLayout, MintLayout } from '@solana/spl-token';
import { findEligibleParticipationBidsForRedemption } from '../../actions/claimUnusedPrizes';
import {
  BidRedemptionTicket,
  MAX_PRIZE_TRACKING_TICKET_SIZE,
  WinningConfigType,
} from '@oyster/common/dist/lib/models/metaplex/index';
import { LoadingOutlined } from '@ant-design/icons';
import { useActionButtonContent } from './hooks/useActionButtonContent';
import { endSale } from './utils/endSale';
import { useInstantSaleState } from './hooks/useInstantSaleState';
import { track } from '../../utils/analytics';

async function calculateTotalCostOfRedeemingOtherPeoplesBids(
  connection: Connection,
  auctionView: AuctionView,
  bids: ParsedAccount<BidderMetadata>[],
  bidRedemptions: Record<string, ParsedAccount<BidRedemptionTicket>>,
): Promise<number> {
  const accountRentExempt = await connection.getMinimumBalanceForRentExemption(
    AccountLayout.span,
  );
  const mintRentExempt = await connection.getMinimumBalanceForRentExemption(
    MintLayout.span,
  );
  const metadataRentExempt = await connection.getMinimumBalanceForRentExemption(
    MAX_METADATA_LEN,
  );
  const editionRentExempt = await connection.getMinimumBalanceForRentExemption(
    MAX_EDITION_LEN,
  );
  const prizeTrackingTicketExempt =
    await connection.getMinimumBalanceForRentExemption(
      MAX_PRIZE_TRACKING_TICKET_SIZE,
    );

  const eligibleParticipations =
    await findEligibleParticipationBidsForRedemption(
      auctionView,
      bids,
      bidRedemptions,
    );
  const max = auctionView.auction.info.bidState.max.toNumber();
  let totalWinnerItems = 0;
  for (let i = 0; i < max; i++) {
    const winner = auctionView.auction.info.bidState.getWinnerAt(i);
    if (!winner) {
      break;
    } else {
      const bid = bids.find(b => b.info.bidderPubkey === winner);
      if (bid) {
        for (
          let j = 0;
          j < auctionView.auctionManager.safetyDepositBoxesExpected.toNumber();
          j++
        ) {
          totalWinnerItems += auctionView.auctionManager
            .getAmountForWinner(i, j)
            .toNumber();
        }
      }
    }
  }
  return (
    (mintRentExempt +
      accountRentExempt +
      metadataRentExempt +
      editionRentExempt +
      prizeTrackingTicketExempt) *
    (eligibleParticipations.length + totalWinnerItems)
  );
}
function useGapTickCheck(
  value: number | undefined,
  gapTick: number | null,
  gapTime: number,
  auctionView: AuctionView,
): boolean {
  return !!useMemo(() => {
    if (gapTick && value && gapTime && !auctionView.auction.info.ended()) {
      // so we have a gap tick percentage, and a gap tick time, and a value, and we're not ended - are we within gap time?
      const now = moment().unix();
      const endedAt = auctionView.auction.info.endedAt;
      if (endedAt) {
        const ended = endedAt.toNumber();
        if (now > ended) {
          const toLamportVal = value * LAMPORTS_PER_SOL;
          // Ok, we are in gap time, since now is greater than ended and we're not actually an ended auction yt.
          // Check that the bid is at least gapTick % bigger than the next biggest one in the stack.
          for (
            let i = auctionView.auction.info.bidState.bids.length - 1;
            i > -1;
            i--
          ) {
            const bid = auctionView.auction.info.bidState.bids[i];
            const expected = bid.amount.toNumber();
            if (expected < toLamportVal) {
              const higherExpectedAmount = expected * ((100 + gapTick) / 100);

              return higherExpectedAmount > toLamportVal;
            } else if (expected === toLamportVal) {
              // If gap tick is set, no way you can bid in this case - you must bid higher.
              return true;
            }
          }
          return false;
        } else {
          return false;
        }
      }
      return false;
    }
  }, [value, gapTick, gapTime, auctionView]);
}

function useAuctionExtended(
  auctionView: AuctionView,
): ParsedAccount<AuctionDataExtended> | undefined {
  const [auctionExtended, setAuctionExtended] =
    useState<ParsedAccount<AuctionDataExtended>>();
  const { auctionDataExtended } = useMeta();

  useMemo(() => {
    const fn = async () => {
      if (!auctionExtended) {
        const PROGRAM_IDS = programIds();
        const extendedKey = await getAuctionExtended({
          auctionProgramId: PROGRAM_IDS.auction,
          resource: auctionView.vault.pubkey,
        });
        const extendedValue = auctionDataExtended[extendedKey];
        if (extendedValue) setAuctionExtended(extendedValue);
      }
    };
    fn();
  }, [auctionDataExtended, auctionExtended, setAuctionExtended]);

  return auctionExtended;
}
export const AuctionCard = ({
  auctionView,
  style,
  hideDefaultAction,
  action,
}: {
  auctionView: AuctionView;
  style?: React.CSSProperties;
  hideDefaultAction?: boolean;
  action?: JSX.Element;
}) => {
  const connection = useConnection();
  const { patchState } = useMeta();

  const wallet = useWallet();
  const { setVisible } = useWalletModal();
  const connect = useCallback(
    () => (wallet.wallet ? wallet.connect().catch() : setVisible(true)),
    [wallet.wallet, wallet.connect, setVisible],
  );

  const mintInfo = useMint(auctionView.auction.info.tokenMint);
  const { prizeTrackingTickets, bidRedemptions } = useMeta();
  const bids = useBidsForAuction(auctionView.auction.pubkey);

  const [value, setValue] = useState<number>();
  const [loading, setLoading] = useState<boolean>(false);
  const [showBidModal, setShowBidModal] = useState<boolean>(false);
  const [showRedeemedBidModal, setShowRedeemedBidModal] =
    useState<boolean>(false);
  const [showEndingBidModal, setShowEndingBidModal] =
    useState<boolean>(false);
  const [showRedemptionIssue, setShowRedemptionIssue] =
    useState<boolean>(false);
  const [showBidPlaced, setShowBidPlaced] = useState<boolean>(false);
  const [lastBid, setLastBid] = useState<{ amount: BN } | undefined>(undefined);
  const [modalHistory, setModalHistory] = useState<any>();
  const [showWarningModal, setShowWarningModal] = useState<boolean>(false);
  const [printingCost, setPrintingCost] = useState<number>();

  const { accountByMint } = useUserAccounts();

  const mintKey = auctionView.auction.info.tokenMint;
  const balance = useUserBalance(mintKey);

  const walletPublickKey = wallet?.publicKey?.toBase58();

  const myPayingAccount = balance.accounts[0];
  let winnerIndex: number | null = null;
  if (auctionView.myBidderPot?.pubkey)
    winnerIndex = auctionView.auction.info.bidState.getWinnerIndex(
      auctionView.myBidderPot?.info.bidderAct,
    );
  const priceFloor =
    auctionView.auction.info.priceFloor.type === PriceFloorType.Minimum
      ? auctionView.auction.info.priceFloor.minPrice?.toNumber() || 0
      : 0;
  const eligibleForOpenEdition = eligibleForParticipationPrizeGivenWinningIndex(
    winnerIndex,
    auctionView,
    auctionView.myBidderMetadata,
    auctionView.myBidRedemption,
  );
  const auctionExtended = useAuctionExtended(auctionView);

  const eligibleForAnything = winnerIndex !== null || eligibleForOpenEdition;
  const gapTime = (auctionView.auction.info.auctionGap?.toNumber() || 0) / 60;
  const gapTick = auctionExtended
    ? auctionExtended.info.gapTickSizePercentage
    : 0;
  const tickSize = auctionExtended ? auctionExtended.info.tickSize : 0;
  const tickSizeInvalid = !!(
    tickSize &&
    value &&
    (value * LAMPORTS_PER_SOL) % tickSize.toNumber() != 0
  );

  const gapBidInvalid = useGapTickCheck(value, gapTick, gapTime, auctionView);

  const isAuctionManagerAuthorityNotWalletOwner =
    auctionView.auctionManager.authority !== walletPublickKey;

  const isAuctionNotStarted =
    auctionView.auction.info.state === AuctionState.Created;

  const isOpenEditionSale =
    auctionView.auction.info.bidState.type === BidStateType.OpenEdition;
  const isBidderPotEmpty = auctionView.myBidderPot ? Boolean(auctionView.myBidderPot?.info.emptied) : true;
  const doesInstantSaleHasNoItems =
    isBidderPotEmpty && auctionView.auctionManager.numWinners.toNumber() === bids.length;

  const shouldHideInstantSale =
    !isOpenEditionSale &&
    auctionView.isInstantSale &&
    isAuctionManagerAuthorityNotWalletOwner &&
    doesInstantSaleHasNoItems;

  const shouldHide = shouldHideInstantSale ||
    (
      auctionView.vault.info.state === VaultState.Deactivated &&
      isBidderPotEmpty
    );

  const {
    isInstantSale,
    canEndInstantSale,
  } = useInstantSaleState(auctionView)
  const actionButtonContent = useActionButtonContent(auctionView)

  if (shouldHide) {
    return <></>;
  }

  return (
    <div className="auction-container" style={style}>
      <Col>
        <AuctionNumbers auctionView={auctionView} />
        {showRedemptionIssue && (
          <span>
            There was an issue redeeming or refunding your bid. Please try
            again.
          </span>
        )}
        {!hideDefaultAction &&
          wallet.connected &&
          auctionView.auction.info.ended() && (
            <Button
              type="primary"
              size="large"
              className="action-btn"
              disabled={
                !myPayingAccount ||
                (!auctionView.myBidderMetadata &&
                  isAuctionManagerAuthorityNotWalletOwner) ||
                loading ||
                !!auctionView.items.find(i => i.find(it => !it.metadata))
              }
              onClick={async () => {
                setLoading(true);
                setShowRedemptionIssue(false);
                if (
                  wallet?.publicKey?.toBase58() ===
                  auctionView.auctionManager.authority
                ) {
                  const totalCost =
                    await calculateTotalCostOfRedeemingOtherPeoplesBids(
                      connection,
                      auctionView,
                      bids,
                      bidRedemptions,
                    );
                  setPrintingCost(totalCost);
                  setShowWarningModal(true);
                }
                try {
                  if (eligibleForAnything) {
                    await sendRedeemBid(
                      connection,
                      wallet,
                      myPayingAccount.pubkey,
                      auctionView,
                      accountByMint,
                      prizeTrackingTickets,
                      bidRedemptions,
                      bids,
                    ).then(() => setShowRedeemedBidModal(true));
                  } else {
                    await sendCancelBid(
                      connection,
                      wallet,
                      myPayingAccount.pubkey,
                      auctionView,
                      accountByMint,
                      bids,
                      bidRedemptions,
                      prizeTrackingTickets,
                    );
                  }
                } catch (e) {
                  console.error(e);
                  setShowRedemptionIssue(true);
                }
                setLoading(false);
              }}
              style={{ marginTop: 20 }}
            >
              {loading ||
                auctionView.items.find(i => i.find(it => !it.metadata)) ||
                !myPayingAccount ? (
                <Spin indicator={<LoadingOutlined />} />
              ) : eligibleForAnything ? (
                `Redeem bid`
              ) : (
                `${wallet?.publicKey &&
                  auctionView.auctionManager.authority ===
                  wallet.publicKey.toBase58()
                  ? 'Reclaim Items'
                  : 'Refund bid'
                }`
              )}
            </Button>
          )}

        {!hideDefaultAction &&
          wallet.connected &&
          !auctionView.auction.info.ended() &&
          (isAuctionNotStarted && !isAuctionManagerAuthorityNotWalletOwner ? (
            <Button
              type="primary"
              size="large"
              className="action-btn"
              disabled={loading}
              onClick={async () => {
                setLoading(true);
                try {
                  await startAuctionManually(
                    connection,
                    wallet,
                    auctionView.auctionManager.instance,
                  );
                } catch (e) {
                  console.error(e);
                }
                setLoading(false);
              }}
              style={{ marginTop: 20 }}
            >
              {loading ? (
                <Spin indicator={<LoadingOutlined />} />
              ) : (
                'Start auction'
              )}
            </Button>
          ) : (
            <Button
              type="primary"
              size="large"
              className="action-btn"
              disabled={loading}
              onClick={() => setShowBidModal(true)}
              style={{ marginTop: 20 }}
            >
              {loading ? (
                <Spin indicator={<LoadingOutlined />} />
              ) : (
                actionButtonContent
              )}
            </Button>
          ))}

        {!hideDefaultAction && !wallet.connected && (
          <Button
            type="primary"
            size="large"
            className="action-btn"
            onClick={connect}
            style={{ marginTop: 20 }}
          >
            Connect wallet to{' '}
            {auctionView.isInstantSale ? 'purchase' : 'place bid'}
          </Button>
        )}
        {action}
      </Col>

      <MetaplexOverlay visible={showBidPlaced}>
        <Confetti />
        <h1
          style={{
            fontSize: '3rem',
            marginBottom: 20,
          }}
        >
          Nice bid!
        </h1>
        <p
          style={{
            textAlign: 'center',
            fontSize: '2rem',
          }}
        >
          Your bid of ◎ {formatTokenAmount(lastBid?.amount, mintInfo)} was
          successful
        </p>
        <Button onClick={() => setShowBidPlaced(false)} className="overlay-btn">
          Got it
        </Button>
      </MetaplexOverlay>

      <MetaplexOverlay visible={showEndingBidModal}>
        <Confetti />
        <h1>
          Congratulations
        </h1>
        <p
          style={{
            color: 'white',
            textAlign: 'center',
            fontSize: '2rem',
          }}
        >
          Your sale has been ended please view your NFTs in <Link to="/artworks">My Items</Link>
          .
        </p>
        <Button
          onClick={() => setShowEndingBidModal(false)}
          className="overlay-btn"
        >
          Got it
        </Button>
      </MetaplexOverlay>

      <MetaplexOverlay visible={showRedeemedBidModal}>
        <Confetti />
        <h1
          style={{
            fontSize: '3rem',
            marginBottom: 20,
          }}
        >
          Congratulations
        </h1>
        <p
          style={{
            textAlign: 'center',
            fontSize: '2rem',
          }}
        >
          Your {auctionView.isInstantSale ? 'purchase' : 'bid'} has been
          redeemed please view your NFTs in <Link to="/artworks">My Items</Link>
          .
        </p>
        <Button
          onClick={() => setShowRedeemedBidModal(false)}
          className="overlay-btn"
        >
          Got it
        </Button>
      </MetaplexOverlay>

      <MetaplexModal
        visible={showBidModal}
        onCancel={() => setShowBidModal(false)}
        bodyStyle={{
          alignItems: 'start',
        }}
        afterClose={() => modalHistory.replace('/placebid')}
      >
        <MemoryRouter>
          <Redirect to="/placebid" />

          <Route
            exact
            path="/placebid"
            render={({ history }) => {
              setModalHistory(history);
              const placeBid = async () => {
                setLoading(true);
                if (myPayingAccount && value) {
                  const bid = await sendPlaceBid(
                    connection,
                    wallet,
                    myPayingAccount.pubkey,
                    auctionView,
                    accountByMint,
                    value,
                  );
                  setLastBid(bid);
                  setShowBidModal(false);
                  setShowBidPlaced(true);
                  setLoading(false);
                  track('bid_submitted', {
                    category: 'auction',
                    label: '',
                    value: value * useSolPrice(), //Google Analytics likes this one in USD :)
                    sol_value: value
                  })
                }
              };

              const endInstantSale = async () => {
                setLoading(true);
                
                try {
                  await endSale({
                    auctionView,
                    connection,
                    accountByMint,
                    bids,
                    bidRedemptions,
                    prizeTrackingTickets,
                    wallet
                  })
                } catch (e) {
                  console.error('endAuction', e);
                  setShowBidModal(false);
                  setLoading(false);
                  return;
                }

                setShowBidModal(false);
                setShowEndingBidModal(true);
                setLoading(false);
              }

              const instantSale = async () => {
                setLoading(true);

                try {
                  const instantSalePrice =
                    auctionView.auctionDataExtended?.info.instantSalePrice;
                  const winningConfigType =
                    auctionView.items[0][0].winningConfigType;
                  const isAuctionItemMaster =
                    winningConfigType ===
                    WinningConfigType.FullRightsTransfer ||
                    winningConfigType === WinningConfigType.TokenOnlyTransfer;
                  const allowBidToPublic =
                    myPayingAccount &&
                    !auctionView.myBidderPot &&
                    isAuctionManagerAuthorityNotWalletOwner;
                  const allowBidToAuctionOwner =
                    myPayingAccount &&
                    !isAuctionManagerAuthorityNotWalletOwner &&
                    isAuctionItemMaster;

                  // Placing a "bid" of the full amount results in a purchase to redeem.
                  if (
                    instantSalePrice &&
                    (allowBidToPublic || allowBidToAuctionOwner)
                  ) {
                    let bidTxid: string | undefined;

                    try {
                      const { amount, txid } = await sendPlaceBid(
                        connection,
                        wallet,
                        myPayingAccount.pubkey,
                        auctionView,
                        accountByMint,
                        instantSalePrice,
                        'confirmed',
                      );
                      setLastBid({ amount });
                      bidTxid = txid;
                      track('instant_sale_completed', {
                        category: 'auction',
                        label: 'confirmed',
                        ...value && {
                          value: value * useSolPrice(), //Google Analytics likes this one in USD :)
                          sol_value: value
                        }
                      })
                    } catch (e) {
                      console.error('sendPlaceBid', e);
                      return;
                    }

                    try {
                      // Attempt to load the transaction, retrying up to 5 times
                      retry: do {
                        for (let i = 0; i < 5; ++i) {
                          const tx = await connection.getTransaction(bidTxid, {
                            commitment: 'confirmed',
                          });

                          const keys = tx?.transaction.message.accountKeys;

                          if (!keys) {
                            await new Promise(o => setTimeout(o, 2000));
                            continue;
                          }

                          const patch = await loadMultipleAccounts(
                            connection,
                            keys.map(k => k.toBase58()),
                            'confirmed',
                          );

                          patchState(patch);
                          setShowBidModal(true);
                          setLoading(true);

                          {
                            const auctionKey = auctionView.auction.pubkey;
                            const auctionBidderKey = `${auctionKey}-${wallet.publicKey}`;

                            auctionView.auction = patch.auctions[auctionKey];
                            auctionView.myBidderPot =
                              patch.bidderPotsByAuctionAndBidder[
                              auctionBidderKey
                              ];
                            auctionView.myBidderMetadata =
                              patch.bidderMetadataByAuctionAndBidder[
                              auctionBidderKey
                              ];
                          }

                          // Stop retrying on success
                          break retry;
                        }

                        // Throw an error if we retry too many times
                        throw new Error("Couldn't get PlaceBid transaction");
                      } while (false);
                    } catch (e) {
                      console.error('update (post-sendPlaceBid)', e);
                      return;
                    }
                  }

                  // Claim the purchase
                  try {
                    await sendRedeemBid(
                      connection,
                      wallet,
                      myPayingAccount.pubkey,
                      auctionView,
                      accountByMint,
                      prizeTrackingTickets,
                      bidRedemptions,
                      bids,
                    );
                  } catch (e) {
                    console.error('sendRedeemBid', e);
                    setShowRedemptionIssue(true);
                    return;
                  }

                  setShowRedeemedBidModal(true);
                } finally {
                  setShowBidModal(false);
                  setLoading(false);
                }
              };


              const actionBtnFn = () => {
                if (!isInstantSale) {
                  return placeBid();
                }

                if (canEndInstantSale) {
                  return endInstantSale();
                }

                return instantSale();
              }

              return (
                <>
                  <h2 className="modal-title">
                    {canEndInstantSale && 'End instant sale'}
                    {!canEndInstantSale && (auctionView.isInstantSale
                      ? 'Confirm Purchase'
                      : 'Place a bid')}
                  </h2>
                  {!!gapTime && (
                    <div
                      className="info-content"
                    >
                      Bids placed in the last {gapTime} minutes will extend
                      bidding for another {gapTime} minutes beyond the point in
                      time that bid was made.{' '}
                      {gapTick && (
                        <span>
                          Additionally, once the official auction end time has
                          passed, only bids {gapTick}% larger than an existing
                          bid will be accepted.
                        </span>
                      )}
                    </div>
                  )}
                  {!canEndInstantSale && <AuctionNumbers auctionView={auctionView} />}
                  <br />
                  {tickSizeInvalid && tickSize && (
                    <span style={{ color: 'red' }}>
                      Tick size is ◎{tickSize.toNumber() / LAMPORTS_PER_SOL}.
                    </span>
                  )}
                  {gapBidInvalid && (
                    <span style={{ color: 'red' }}>
                      Your bid needs to be at least {gapTick}% larger than an
                      existing bid during gap periods to be eligible.
                    </span>
                  )}

                  <div
                    className="amount-container"
                  >
                    {!auctionView.isInstantSale && (
                      <InputNumber
                        autoFocus
                        className="input"
                        value={value}
                        style={{
                          width: '100%',
                          borderRadius: 16,
                        }}
                        onChange={setValue}
                        precision={4}
                        formatter={value =>
                          value
                            ? `◎ ${value}`.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
                            : ''
                        }
                        placeholder="Amount in SOL"
                      />
                    )}
                    {!(auctionView.isInstantSale && bids.length > 0) && (
                      <>
                        <div
                          style={{
                            color: '#FFFFFF',
                            display: 'inline-block',
                            margin: '5px 20px',
                            fontWeight: 700,
                          }}
                        >
                          ◎ {formatAmount(balance.balance, 2)}{' '}
                          <span
                            style={{ paddingLeft: '5px' }}
                          >
                            available
                          </span>
                        </div>
                        <Link
                          to="/addfunds"
                          style={{
                            float: 'right',
                            margin: '5px 20px',
                          }}
                        >
                          Add funds
                        </Link>
                      </>
                    )}
                  </div>

                  <br />
                  <Button
                    type="primary"
                    size="large"
                    className="action-btn"
                    onClick={() => actionBtnFn()}
                    disabled={
                      tickSizeInvalid ||
                      gapBidInvalid ||
                      !myPayingAccount ||
                      (!auctionView.isInstantSale &&
                        (value === undefined ||
                          value * LAMPORTS_PER_SOL < priceFloor)) ||
                      loading ||
                      !accountByMint.get(QUOTE_MINT.toBase58())
                    }
                  >
                    {loading || !accountByMint.get(QUOTE_MINT.toBase58()) ? (
                      <Spin indicator={<LoadingOutlined />} />
                    ) : (
                      actionButtonContent
                    )}
                  </Button>
                </>
              );
            }}
          />

          <Route exact path="/addfunds">
            <div style={{ maxWidth: '100%' }}>
              <h2>Add funds</h2>
              <p style={{ color: 'white' }}>
                We partner with <b>FTX</b> to make it simple to start purchasing
                digital collectibles.
              </p>
              <div
                style={{
                  width: '100%',
                  background: '#242424',
                  borderRadius: 12,
                  marginBottom: 10,
                  height: 50,
                  display: 'flex',
                  alignItems: 'center',
                  padding: '0 10px',
                  justifyContent: 'space-between',
                  fontWeight: 700,
                }}
              >
                <span style={{ color: 'rgba(255, 255, 255, 0.5)' }}>
                  Balance
                </span>
                <span>
                  {formatAmount(balance.balance, 2)}&nbsp;&nbsp;
                  <span
                    style={{
                      borderRadius: '50%',
                      background: 'black',
                      display: 'inline-block',
                      padding: '1px 4px 4px 4px',
                      lineHeight: 1,
                    }}
                  >
                    <img src="/sol.svg" width="10" />
                  </span>{' '}
                  SOL
                </span>
              </div>
              <p>
                If you have not used FTX Pay before, it may take a few moments
                to get set up.
              </p>
              <Button
                onClick={() => modalHistory.push('/placebid')}
                style={{
                  background: '#454545',
                  borderRadius: 14,
                  width: '30%',
                  padding: 10,
                  height: 'auto',
                }}
              >
                Back
              </Button>
              <Button
                onClick={() => {
                  window.open(
                    `https://ftx.com/pay/request?coin=SOL&address=${wallet.publicKey?.toBase58()}&tag=&wallet=sol&memoIsRequired=false`,
                    '_blank',
                    'resizable,width=680,height=860',
                  );
                }}
                style={{
                  background: 'black',
                  borderRadius: 14,
                  width: '68%',
                  marginLeft: '2%',
                  padding: 10,
                  height: 'auto',
                  borderColor: 'black',
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    placeContent: 'center',
                    justifyContent: 'center',
                    alignContent: 'center',
                    alignItems: 'center',
                    fontSize: 16,
                  }}
                >
                  <span style={{ marginRight: 5 }}>Sign with</span>
                  <img src="/ftxpay.png" width="80" />
                </div>
              </Button>
            </div>
          </Route>
        </MemoryRouter>
      </MetaplexModal>

      <MetaplexModal
        visible={showWarningModal}
        onCancel={() => setShowWarningModal(false)}
        bodyStyle={{
          alignItems: 'start',
        }}
      >
        <h3 style={{ color: 'white' }}>
          Warning: There may be some items in this auction that still are
          required by the auction for printing bidders' limited or open edition
          NFTs. If you wish to withdraw them, you are agreeing to foot the cost
          of up to an estimated ◎<b>{(printingCost || 0) / LAMPORTS_PER_SOL}</b>{' '}
          plus transaction fees to redeem their bids for them right now.
        </h3>
      </MetaplexModal>
    </div>
  );
};
