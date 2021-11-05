import { Alert, Button, Layout, Tabs, Spin, List } from 'antd';
import Masonry from 'react-masonry-css';
import React from 'react';
import { Link } from 'react-router-dom';
import { AuctionRenderCard } from '../../components/AuctionRenderCard';
import useInfiniteScroll from 'react-infinite-scroll-hook';
import { LoadingOutlined } from '@ant-design/icons';
import { useInfiniteScrollAuctions, } from '../../hooks';
import { useStore } from '@oyster/common';
import { useAuctionManagersToCache } from '../../hooks';
import { useWallet } from '@solana/wallet-adapter-react';
import { track } from '../../utils/analytics';
import { useCoingecko, useSolPrice } from '../../contexts';

export enum LiveAuctionViewState {
  All = '0',
  Participated = '1',
  Ended = '2',
  Resale = '3',
}

export const AuctionListView = () => {
  const { auctions, loading, initLoading, hasNextPage, loadMore } = useInfiniteScrollAuctions();

  const [sentryRef] = useInfiniteScroll({
    loading,
    hasNextPage,
    onLoadMore: loadMore,
    rootMargin: '0px 0px 200px 0px',
  });

  const breakpointColumnsObj = {
    default: 4,
    1100: 3,
    700: 2,
    500: 1,
  };

  const { ownerAddress, storefront } = useStore();
  const wallet = useWallet();
  const { auctionManagerTotal, auctionCacheTotal } = useAuctionManagersToCache();
  const isStoreOwner = ownerAddress === wallet.publicKey?.toBase58();
  const notAllAuctionsCached = auctionManagerTotal !== auctionCacheTotal;
  const showCacheAuctionsAlert = isStoreOwner && notAllAuctionsCached;
  
  return (
    initLoading ? (
      <div className="app-section--loading">
        <Spin indicator={<LoadingOutlined />} />
      </div>
    ) : (
      <>
        {showCacheAuctionsAlert && (
          <Alert
            message="Attention Store Owner"
            className="app-alert-banner"
            description={(
              <p>
                Make your storefront faster by enabling listing caches. {auctionCacheTotal}/{auctionManagerTotal} of your listing have a cache account. Watch this <a rel="noopener noreferrer" target="_blank" href="https://youtu.be/02V7F07DFbk">video</a> for more details and a walkthrough. On November 3rd storefronts will start reading from the cache for listings. All new listing are generating a cache account.
              </p>
            )}
            type="info"
            showIcon
            action={
              <Link to="/admin">
                <Button>Visit Admin</Button>
              </Link>
            }
          />
        )}
        <Masonry
          breakpointCols={breakpointColumnsObj}
          className="my-masonry-grid"
          columnClassName="my-masonry-grid_column"
        >
          {auctions.map((m, idx) => {
            const id = m.auction.pubkey;
            return (
              <Link to={`/auction/${id}`} key={idx} onClick={() => {
                track('view_item', {
                  category: 'auction',
                  currency: "USD",
                  value: 2 * 244, //solPrice * solValue,w
                  sol_value: 2,
                  items: m.items.flat().map((i,j) => ({
                    item_id: i.metadata.info.data.uri,
                    item_name: i.metadata.info.data.name,
                    affiliation: storefront.subdomain, // or page title?
                    currency: 'USD',
                    price: i.amount.toNumber() * useSolPrice(),
                    sol_value: i.amount.toNumber(),
                    index: j,
                    quantity: 1
                  }))
                  // label: m.items.map(i => i.map(ii => ii.metadata.info.data.name))
                })
              }}>
                <AuctionRenderCard key={id} auctionView={m}  />
              </Link>
            );
          })}
        </Masonry>
        {hasNextPage && (
          <div className="app-section--loading" ref={sentryRef}>
            <Spin indicator={<LoadingOutlined />} />
          </div>)
        }
      </>
    )
  );
};