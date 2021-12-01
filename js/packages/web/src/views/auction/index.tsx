import { CheckOutlined, LoadingOutlined } from '@ant-design/icons';
import {
  AuctionState,
  BidderMetadata,
  formatTokenAmount,
  Identicon,
  MetaplexModal,
  ParsedAccount,
  shortenAddress,
  StringPublicKey,
  toPublicKey,
  useConnection,
  useMint,
  useMeta,
  subscribeProgramChanges,
  AUCTION_ID,
  processAuctions,
  METAPLEX_ID,
  processMetaplexAccounts,
  VAULT_ID,
  processVaultData,
} from '@oyster/common';
import { AuctionViewItem } from '@oyster/common/dist/lib/models/metaplex/index';
import { getHandleAndRegistryKey } from '@solana/spl-name-service';
import { MintInfo } from '@solana/spl-token';
import { Link } from 'react-router-dom';
import { useWallet } from '@solana/wallet-adapter-react';
import { Connection } from '@solana/web3.js';
import {
  Button,
  Carousel,
  Col,
  List,
  Row,
  Skeleton,
  Space,
  Spin,
  Typography,
} from 'antd';
import React, { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { format } from 'timeago.js';
import { AmountLabel } from '../../components/AmountLabel';
import { ArtContent } from '../../components/ArtContent';
import { AuctionCard } from '../../components/AuctionCard';
import { ClickToCopy } from '../../components/ClickToCopy';
import { MetaAvatar } from '../../components/MetaAvatar';
import { ViewOn } from '../../components/ViewOn';
import {
  AuctionView as Auction,
  useArt,
  useAuction,
  useBidsForAuction,
  useCreators,
  useExtendedArt,
} from '../../hooks';
import { ArtType } from '../../types';
import useWindowDimensions from '../../utils/layout';
import { useAnalytics } from '../../components/Analytics';

const { Text } = Typography;

export const AuctionItem = ({
  item,
  active,
}: {
  item: AuctionViewItem;
  active?: boolean;
}) => {
  const id = item.metadata.pubkey;
  return <ArtContent pubkey={id} active={active} allowMeshRender={true} />;
};

export const AuctionView = () => {
  const { id } = useParams<{ id: string }>();
  const { loading, auction } = useAuction(id);
  const connection = useConnection();
  const { patchState } = useMeta();
  const [currentIndex, setCurrentIndex] = useState(0);
  const art = useArt(auction?.thumbnail.metadata.pubkey);
  const { ref, data } = useExtendedArt(auction?.thumbnail.metadata.pubkey);
  const creators = useCreators(auction);
  const wallet = useWallet();
  const { track } = useAnalytics();

  let edition = '';
  if (art.type === ArtType.NFT) {
    edition = 'Unique';
  } else if (art.type === ArtType.Master) {
    edition = 'NFT 0';
  } else if (art.type === ArtType.Print) {
    edition = `${art.edition} of ${art.supply}`;
  }
  const nftCount = auction?.items.flat().length;
  console.log('nfts', auction?.items);
  const winnerCount = auction?.items.length;

  const hasDescription = data === undefined || data.description === undefined;
  const description = data?.description;
  const attributes = data?.attributes;

  useEffect(() => {
    return subscribeProgramChanges(
      connection,
      patchState,
      {
        programId: AUCTION_ID,
        processAccount: processAuctions,
      },
      {
        programId: METAPLEX_ID,
        processAccount: processMetaplexAccounts,
      },
      {
        programId: VAULT_ID,
        processAccount: processVaultData,
      },
    );
  }, [connection]);

  if (loading) {
    return (
      <div className="app-section--loading">
        <Spin indicator={<LoadingOutlined />} />
      </div>
    );
  }

  const items = [
    ...(auction?.items
      .flat()
      .reduce((agg, item) => {
        agg.set(item.metadata.pubkey, item);
        return agg;
      }, new Map<string, AuctionViewItem>())
      .values() || []),
    auction?.participationItem,
  ].map((item, index) => {
    if (!item || !item?.metadata || !item.metadata?.pubkey) {
      return null;
    }

    return (
      <AuctionItem
        key={item.metadata.pubkey}
        item={item}
        active={index === currentIndex}
      />
    );
  });

  return (
    <Row justify="center" ref={ref} gutter={[48, 0]}>
      <Col span={24} md={{ span: 20 }} lg={9}>
        <Carousel
          className="metaplex-spacing-bottom-md"
          autoplay={false}
          afterChange={index => setCurrentIndex(index)}
        >
          {items}
        </Carousel>
        <Space direction="vertical" size="small">
          <Text>ABOUT THIS {nftCount === 1 ? 'NFT' : 'COLLECTION'}</Text>
          <p>
            {hasDescription && <Skeleton paragraph={{ rows: 3 }} />}
            {description ||
              (winnerCount !== undefined && (
                <div>No description provided.</div>
              ))}
          </p>
          <Button
            onClick={() => {
              const params = {
                text: "I've listed an NFT on my @Holaplex store, check it out!",
                url: `${
                  window.location.origin
                }/#/auction/${auction?.auction.pubkey.toString()}`,
                hashtags: 'NFT,Crypto,Metaplex',
                // via: "Metaplex",
                related: 'Metaplex,Solana',
              };
              const queryParams = new URLSearchParams(params).toString();
              const newTweetURL = `https://twitter.com/intent/tweet?${queryParams}`;
              track('share', {
                method: 'Twitter',
                content_type: 'auction',
                listing_id: id,
                // nft_id: auction?.items.find(
                //   nft => nft[0].masterEdition?.pubkey,
                // ),
              });
              window.open(newTweetURL, '_blank');
            }}
          >
            Share auction
          </Button>
        </Space>
        {attributes && (
          <div>
            <Text>Attributes</Text>
            <List grid={{ column: 4 }}>
              {attributes.map((attribute, index) => (
                <List.Item key={`${attribute.value}-${index}`}>
                  <List.Item.Meta
                    title={attribute.trait_type}
                    description={attribute.value}
                  />
                </List.Item>
              ))}
            </List>
          </div>
        )}
      </Col>

      <Col span={24} lg={{ offset: 1, span: 13 }}>
        <Row justify="space-between">
          <h2>{art.title || <Skeleton paragraph={{ rows: 0 }} />}</h2>
          {wallet.publicKey?.toBase58() ===
            auction?.auctionManager.authority && (
            <Link to={`/auction/${id}/billing`}>
              <Button type="ghost">Billing</Button>
            </Link>
          )}
        </Row>
        <Row className="metaplex-spacing-bottom-lg">
          <Col span={12}>
            <Space direction="horizontal" align="start">
              <Space direction="vertical" size="small">
                <Text>CREATED BY</Text>
                <MetaAvatar creators={creators} />
              </Space>
              <Space direction="vertical" size="small">
                <Text>Edition</Text>
                {(auction?.items.length || 0) > 1 ? 'Multiple' : edition}
              </Space>
              <Space direction="vertical" size="small">
                <Text>Winners</Text>
                <span>
                  {winnerCount === undefined ? (
                    <Skeleton paragraph={{ rows: 0 }} />
                  ) : (
                    winnerCount
                  )}
                </span>
              </Space>
              <Space direction="vertical" size="small">
                <Text>NFTS</Text>
                {nftCount === undefined ? (
                  <Skeleton paragraph={{ rows: 0 }} />
                ) : (
                  nftCount
                )}
              </Space>
            </Space>
          </Col>
          <Col span={12}>
            <Row justify="end">
              <ViewOn art={art} />
            </Row>
          </Col>
        </Row>

        {!auction && <Skeleton paragraph={{ rows: 6 }} />}
        {auction && (
          <AuctionCard auctionView={auction} hideDefaultAction={false} />
        )}
        {!auction?.isInstantSale && <AuctionBids auctionView={auction} />}
      </Col>
    </Row>
  );
};

const BidLine = (props: {
  bid: ParsedAccount<BidderMetadata>;
  index: number;
  mint?: MintInfo;
  isCancelled?: boolean;
  isActive?: boolean;
}) => {
  const { bid, mint, isCancelled } = props;
  const { publicKey } = useWallet();
  const bidder = bid.info.bidderPubkey;
  const isme = publicKey?.toBase58() === bidder;

  // Get Twitter Handle from address
  const connection = useConnection();
  const [bidderTwitterHandle, setBidderTwitterHandle] = useState('');
  useEffect(() => {
    const getTwitterHandle = async (
      connection: Connection,
      bidder: StringPublicKey,
    ): Promise<string | undefined> => {
      try {
        const [twitterHandle] = await getHandleAndRegistryKey(
          connection,
          toPublicKey(bidder),
        );
        setBidderTwitterHandle(twitterHandle);
      } catch (err) {
        console.warn(`err`);
        return undefined;
      }
    };
    getTwitterHandle(connection, bidder);
  }, [bidderTwitterHandle]);

  return (
    <Row wrap={false} align="middle" className="metaplex-fullwidth">
      <Col span={9}>
        {isCancelled ? (
          <div />
        ) : (
          <Space direction="horizontal">
            {isme && <CheckOutlined />}
            <AmountLabel
              displaySOL={true}
              amount={formatTokenAmount(bid.info.lastBid, mint)}
            />
          </Space>
        )}
      </Col>

      <Col span={6}>
        {/* uses milliseconds */}
        {format(bid.info.lastBidTimestamp.toNumber() * 1000)}
      </Col>
      <Col span={9}>
        <Space
          direction="horizontal"
          align="center"
          className="metaplex-fullwidth metaplex-space-justify-end"
        >
          <Identicon size={24} address={bidder} />
          {bidderTwitterHandle ? (
            <a
              target="_blank"
              rel="noopener noreferrer"
              title={shortenAddress(bidder)}
              href={`https://twitter.com/${bidderTwitterHandle}`}
            >{`@${bidderTwitterHandle}`}</a>
          ) : (
            shortenAddress(bidder)
          )}
          <ClickToCopy copyText={bidder} />
        </Space>
      </Col>
    </Row>
  );
};

export const AuctionBids = ({
  auctionView,
}: {
  auctionView?: Auction | null;
}) => {
  const bids = useBidsForAuction(auctionView?.auction.pubkey || '');

  const mint = useMint(auctionView?.auction.info.tokenMint);
  const { width } = useWindowDimensions();

  const [showHistoryModal, setShowHistoryModal] = useState<boolean>(false);

  const winnersCount = auctionView?.auction.info.bidState.max.toNumber() || 0;
  const activeBids = auctionView?.auction.info.bidState.bids || [];
  const activeBidders = useMemo(() => {
    return new Set(activeBids.map(b => b.key));
  }, [activeBids]);

  const auctionState = auctionView
    ? auctionView.auction.info.state
    : AuctionState.Created;
  const bidLines = useMemo(() => {
    let activeBidIndex = 0;
    return bids.map((bid, index) => {
      const isCancelled =
        (index < winnersCount && !!bid.info.cancelled) ||
        (auctionState !== AuctionState.Ended && !!bid.info.cancelled);

      const line = (
        <BidLine
          bid={bid}
          index={activeBidIndex}
          key={index}
          mint={mint}
          isCancelled={isCancelled}
          isActive={!bid.info.cancelled}
        />
      );

      if (!isCancelled) {
        activeBidIndex++;
      }

      return line;
    });
  }, [auctionState, bids, activeBidders]);

  if (!auctionView || bids.length < 1) return null;

  return (
    <Space direction="vertical" className="metaplex-fullwidth">
      <Text>Bid History</Text>
      <div>{bidLines.slice(0, 10)}</div>
      {bids.length > 10 && (
        <Button onClick={() => setShowHistoryModal(true)}>
          View full history
        </Button>
      )}
      <MetaplexModal
        visible={showHistoryModal}
        onCancel={() => setShowHistoryModal(false)}
        title="Bid history"
        centered
        width={width < 768 ? width - 10 : 600}
      >
        {bidLines}
      </MetaplexModal>
    </Space>
  );
};
